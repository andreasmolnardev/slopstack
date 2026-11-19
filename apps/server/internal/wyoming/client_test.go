package wyoming

import (
	"bufio"
	"context"
	"net"
	"strings"
	"testing"
	"time"
)

func TestEventRoundTripPreservesAdditionalDataAndPayload(t *testing.T) {
	left, right := net.Pipe()
	done := make(chan error, 1)
	go func() {
		done <- WriteEvent(left, Event{Type: "audio-chunk", Data: map[string]any{"rate": 16000}, Additional: []byte(`{"language":"en"}`), Payload: []byte{1, 2, 3}})
		left.Close()
	}()
	event, err := ReadEvent(bufio.NewReader(right))
	if err != nil {
		t.Fatal(err)
	}
	if event.Type != "audio-chunk" || string(event.Additional) != `{"language":"en"}` || len(event.Payload) != 3 {
		t.Fatalf("unexpected event: %#v", event)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	right.Close()
}

func TestSynthesizeBuildsWavFromWyomingEvents(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	go func() {
		conn, acceptErr := listener.Accept()
		if acceptErr != nil {
			return
		}
		defer conn.Close()
		reader := bufio.NewReader(conn)
		request, readErr := ReadEvent(reader)
		if readErr != nil || request.Type != "synthesize" {
			return
		}
		_ = WriteEvent(conn, Event{Type: "audio-start", Data: map[string]any{"rate": 22050, "width": 2, "channels": 1}})
		_ = WriteEvent(conn, Event{Type: "audio-chunk", Payload: []byte{1, 2, 3, 4}})
		_ = WriteEvent(conn, Event{Type: "audio-stop"})
	}()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	audio, rate, width, channels, err := Synthesize(ctx, listener.Addr().String(), "Hello", "", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if rate != 22050 || width != 2 || channels != 1 || string(audio[:4]) != "RIFF" || len(audio) != 48 {
		t.Fatalf("unexpected wav metadata or size: %d %d %d %d", rate, width, channels, len(audio))
	}
}

func TestReadEventRejectsOversizedPayload(t *testing.T) {
	reader := bufio.NewReader(strings.NewReader("{\"type\":\"audio-chunk\",\"payload_length\":33554433}\n"))
	if _, err := ReadEvent(reader); err == nil {
		t.Fatal("oversized payload should be rejected")
	}
}

func TestParseWAVAcceptsPCMAndRejectsCompressed(t *testing.T) {
	encoded := wav([]byte{1, 2, 3, 4}, 16000, 2, 1)
	pcm, rate, width, channels, err := ParseWAV(encoded)
	if err != nil {
		t.Fatal(err)
	}
	if len(pcm) != 4 || rate != 16000 || width != 2 || channels != 1 {
		t.Fatalf("unexpected WAV parse: %d %d %d %d", len(pcm), rate, width, channels)
	}
	encoded[20] = 3
	if _, _, _, _, err := ParseWAV(encoded); err == nil {
		t.Fatal("compressed audio should be rejected")
	}
}

func TestTranscribeUsesWyomingSequence(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	go func() {
		conn, e := listener.Accept()
		if e != nil {
			return
		}
		defer conn.Close()
		reader := bufio.NewReader(conn)
		for _, expected := range []string{"transcribe", "audio-start", "audio-chunk", "audio-stop"} {
			event, e := ReadEvent(reader)
			if e != nil || event.Type != expected {
				return
			}
		}
		_ = WriteEvent(conn, Event{Type: "transcript", Data: map[string]any{"text": "hello world"}})
	}()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	text, err := Transcribe(ctx, listener.Addr().String(), "en", 16000, 2, 1, []byte{1, 2}, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if text != "hello world" {
		t.Fatalf("transcript=%q", text)
	}
}
