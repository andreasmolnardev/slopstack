// Package wyoming implements the binary-safe Wyoming JSONL event framing used
// by Piper and Whisper services.
package wyoming

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"strings"
	"time"
)

const maxHeader = 64 << 10

type Event struct {
	Type          string         `json:"type"`
	Data          map[string]any `json:"data,omitempty"`
	DataLength    int            `json:"data_length,omitempty"`
	PayloadLength int            `json:"payload_length,omitempty"`
	Additional    []byte         `json:"-"`
	Payload       []byte         `json:"-"`
}

func WriteEvent(w io.Writer, event Event) error {
	event.DataLength = len(event.Additional)
	event.PayloadLength = len(event.Payload)
	header, err := json.Marshal(event)
	if err != nil {
		return err
	}
	if len(header) > maxHeader {
		return fmt.Errorf("wyoming header too large")
	}
	if _, err = w.Write(append(header, '\n')); err != nil {
		return err
	}
	if _, err = w.Write(event.Additional); err != nil {
		return err
	}
	_, err = w.Write(event.Payload)
	return err
}

func ReadEvent(r *bufio.Reader) (Event, error) {
	var event Event
	line, err := r.ReadBytes('\n')
	if err != nil {
		return event, err
	}
	if len(line) > maxHeader {
		return event, fmt.Errorf("wyoming header too large")
	}
	if err := json.Unmarshal(line, &event); err != nil {
		return event, err
	}
	if event.Type == "" || event.DataLength < 0 || event.PayloadLength < 0 || event.DataLength > maxHeader || event.PayloadLength > 32<<20 {
		return event, fmt.Errorf("invalid wyoming event lengths")
	}
	if event.DataLength > 0 {
		event.Additional = make([]byte, event.DataLength)
		if _, err := io.ReadFull(r, event.Additional); err != nil {
			return event, err
		}
	}
	if event.PayloadLength > 0 {
		event.Payload = make([]byte, event.PayloadLength)
		if _, err := io.ReadFull(r, event.Payload); err != nil {
			return event, err
		}
	}
	return event, nil
}

func Dial(ctx context.Context, address string, timeout time.Duration) (net.Conn, error) {
	d := net.Dialer{Timeout: timeout}
	return d.DialContext(ctx, "tcp", address)
}

func Discover(ctx context.Context, address string, timeout time.Duration) (map[string]any, error) {
	conn, err := Dial(ctx, address, timeout)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(timeout))
	if err := WriteEvent(conn, Event{Type: "describe"}); err != nil {
		return nil, err
	}
	event, err := ReadEvent(bufio.NewReader(conn))
	if err != nil {
		return nil, err
	}
	if event.Type != "info" {
		return nil, fmt.Errorf("expected info event, got %q", event.Type)
	}
	return event.Data, nil
}

func Synthesize(ctx context.Context, address, text, voice string, timeout time.Duration) ([]byte, int, int, int, error) {
	conn, err := Dial(ctx, address, timeout)
	if err != nil {
		return nil, 0, 0, 0, err
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(timeout))
	data := map[string]any{"text": text}
	if voice != "" {
		data["voice"] = map[string]any{"name": voice}
	}
	if err := WriteEvent(conn, Event{Type: "synthesize", Data: data}); err != nil {
		return nil, 0, 0, 0, err
	}
	reader := bufio.NewReader(conn)
	var audio []byte
	rate, width, channels := 0, 0, 0
	started := false
	for {
		event, err := ReadEvent(reader)
		if err != nil {
			return nil, 0, 0, 0, err
		}
		switch event.Type {
		case "audio-start":
			started = true
			rate = intNumber(event.Data["rate"])
			width = intNumber(event.Data["width"])
			channels = intNumber(event.Data["channels"])
			if rate <= 0 || width <= 0 || channels <= 0 {
				return nil, 0, 0, 0, fmt.Errorf("invalid audio-start metadata")
			}
		case "audio-chunk":
			if !started {
				return nil, 0, 0, 0, fmt.Errorf("audio-chunk before audio-start")
			}
			audio = append(audio, event.Payload...)
		case "audio-stop":
			if !started || len(audio) == 0 {
				return nil, 0, 0, 0, fmt.Errorf("synthesis returned no audio")
			}
			return wav(audio, rate, width, channels), rate, width, channels, nil
		case "error":
			return nil, 0, 0, 0, fmt.Errorf("Wyoming synthesis error: %v", event.Data)
		default:
			continue
		}
	}
}

func Transcribe(ctx context.Context, address, language string, rate, width, channels int, pcm []byte, timeout time.Duration) (string, error) {
	conn, err := Dial(ctx, address, timeout)
	if err != nil {
		return "", err
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(timeout))
	start := map[string]any{"rate": rate, "width": width, "channels": channels}
	if language != "" {
		if err := WriteEvent(conn, Event{Type: "transcribe", Data: map[string]any{"language": language}}); err != nil {
			return "", err
		}
	} else if err := WriteEvent(conn, Event{Type: "transcribe"}); err != nil {
		return "", err
	}
	if err := WriteEvent(conn, Event{Type: "audio-start", Data: start}); err != nil {
		return "", err
	}
	const chunkSize = 32000
	for offset := 0; offset < len(pcm); offset += chunkSize {
		end := offset + chunkSize
		if end > len(pcm) {
			end = len(pcm)
		}
		if err := WriteEvent(conn, Event{Type: "audio-chunk", Data: start, Payload: pcm[offset:end]}); err != nil {
			return "", err
		}
	}
	if err := WriteEvent(conn, Event{Type: "audio-stop"}); err != nil {
		return "", err
	}
	reader := bufio.NewReader(conn)
	for {
		event, err := ReadEvent(reader)
		if err != nil {
			return "", err
		}
		switch event.Type {
		case "transcript":
			text, _ := event.Data["text"].(string)
			if strings.TrimSpace(text) == "" {
				return "", fmt.Errorf("empty transcript")
			}
			return text, nil
		case "error", "not-recognized":
			return "", fmt.Errorf("Wyoming transcription failed: %v", event.Data)
		}
	}
}

func intNumber(value any) int {
	switch n := value.(type) {
	case float64:
		return int(n)
	case int:
		return n
	}
	return 0
}

func wav(pcm []byte, rate, width, channels int) []byte {
	header := make([]byte, 44)
	copy(header[0:4], "RIFF")
	put32(header[4:8], uint32(36+len(pcm)))
	copy(header[8:12], "WAVE")
	copy(header[12:16], "fmt ")
	put32(header[16:20], 16)
	put16(header[20:22], 1)
	put16(header[22:24], uint16(channels))
	put32(header[24:28], uint32(rate))
	put32(header[28:32], uint32(rate*channels*width))
	put16(header[32:34], uint16(channels*width))
	put16(header[34:36], uint16(width*8))
	copy(header[36:40], "data")
	put32(header[40:44], uint32(len(pcm)))
	return append(header, pcm...)
}
func put16(dst []byte, value uint16) { dst[0] = byte(value); dst[1] = byte(value >> 8) }
func put32(dst []byte, value uint32) {
	dst[0] = byte(value)
	dst[1] = byte(value >> 8)
	dst[2] = byte(value >> 16)
	dst[3] = byte(value >> 24)
}

func ParseWAV(data []byte) (pcm []byte, rate, width, channels int, err error) {
	if len(data) < 44 || string(data[:4]) != "RIFF" || string(data[8:12]) != "WAVE" {
		return nil, 0, 0, 0, fmt.Errorf("invalid WAV header")
	}
	format, channels16, rate32 := uint16(0), uint16(0), uint32(0)
	width16 := uint16(0)
	var audio []byte
	reader := bytes.NewReader(data[12:])
	for reader.Len() >= 8 {
		var chunkHeader [8]byte
		if err = binary.Read(reader, binary.LittleEndian, &chunkHeader); err != nil {
			break
		}
		size := int(binary.LittleEndian.Uint32(chunkHeader[4:]))
		if size < 0 || size > reader.Len() {
			return nil, 0, 0, 0, fmt.Errorf("invalid WAV chunk size")
		}
		chunk := make([]byte, size)
		if _, err = io.ReadFull(reader, chunk); err != nil {
			return nil, 0, 0, 0, err
		}
		switch string(chunkHeader[:4]) {
		case "fmt ":
			if len(chunk) < 16 {
				return nil, 0, 0, 0, fmt.Errorf("invalid WAV format chunk")
			}
			format = binary.LittleEndian.Uint16(chunk[0:2])
			channels16 = binary.LittleEndian.Uint16(chunk[2:4])
			rate32 = binary.LittleEndian.Uint32(chunk[4:8])
			width16 = binary.LittleEndian.Uint16(chunk[14:16])
		case "data":
			audio = chunk
		}
		if size%2 == 1 && reader.Len() > 0 {
			_, _ = reader.ReadByte()
		}
	}
	if format != 1 || rate32 < 8000 || rate32 > 96000 || width16 != 16 || (channels16 != 1 && channels16 != 2) || len(audio) == 0 || len(audio) > 20<<20 {
		return nil, 0, 0, 0, fmt.Errorf("WAV must be PCM 16-bit mono/stereo from 8-96 kHz and at most 20 MiB")
	}
	return audio, int(rate32), 2, int(channels16), nil
}
