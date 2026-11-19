package wyoming

import (
	"encoding/binary"
	"fmt"
)

type pcmWAV struct {
	data     []byte
	rate     int
	width    int
	channels int
}

// AssembleWAV joins mono or multichannel PCM WAV segments with the same format.
// maxBytes caps the complete result, including its output header.
func AssembleWAV(segments [][]byte, maxBytes int) ([]byte, error) {
	if len(segments) == 0 || maxBytes < 44 {
		return nil, fmt.Errorf("WAV assembly needs segments and a limit of at least 44 bytes")
	}
	var format pcmWAV
	var total int
	for index, segment := range segments {
		parsed, err := parsePCMWAV(segment)
		if err != nil {
			return nil, fmt.Errorf("WAV segment %d: %w", index+1, err)
		}
		if index == 0 {
			format = parsed
		} else if parsed.rate != format.rate || parsed.width != format.width || parsed.channels != format.channels {
			return nil, fmt.Errorf("WAV segments have mismatched sample formats")
		}
		if len(parsed.data) > maxBytes-44-total {
			return nil, fmt.Errorf("assembled WAV exceeds %d byte limit", maxBytes)
		}
		total += len(parsed.data)
	}
	pcm := make([]byte, 0, total)
	for _, segment := range segments {
		parsed, _ := parsePCMWAV(segment)
		pcm = append(pcm, parsed.data...)
	}
	return wav(pcm, format.rate, format.width, format.channels), nil
}

func parsePCMWAV(input []byte) (pcmWAV, error) {
	if len(input) < 12 || string(input[:4]) != "RIFF" || string(input[8:12]) != "WAVE" {
		return pcmWAV{}, fmt.Errorf("invalid RIFF/WAVE header")
	}
	riffSize := uint64(binary.LittleEndian.Uint32(input[4:8]))
	riffEnd := riffSize + 8
	if riffSize < 4 || riffEnd != uint64(len(input)) {
		return pcmWAV{}, fmt.Errorf("invalid RIFF size")
	}
	var haveFormat, haveData bool
	var result pcmWAV
	for offset := uint64(12); offset < riffEnd; {
		if riffEnd-offset < 8 {
			return pcmWAV{}, fmt.Errorf("truncated RIFF chunk header")
		}
		chunkHeader := input[int(offset):int(offset+8)]
		chunkSize := uint64(binary.LittleEndian.Uint32(chunkHeader[4:8]))
		chunkStart := offset + 8
		chunkEnd := chunkStart + chunkSize
		paddedEnd := chunkEnd + chunkSize%2
		if chunkEnd < chunkStart || paddedEnd < chunkEnd || paddedEnd > riffEnd {
			return pcmWAV{}, fmt.Errorf("truncated or invalid RIFF chunk")
		}
		chunk := input[int(chunkStart):int(chunkEnd)]
		switch string(chunkHeader[:4]) {
		case "fmt ":
			if haveFormat || len(chunk) < 16 {
				return pcmWAV{}, fmt.Errorf("missing or invalid PCM format chunk")
			}
			encoding := binary.LittleEndian.Uint16(chunk[0:2])
			channels := int(binary.LittleEndian.Uint16(chunk[2:4]))
			rate := binary.LittleEndian.Uint32(chunk[4:8])
			byteRate := binary.LittleEndian.Uint32(chunk[8:12])
			blockAlign := binary.LittleEndian.Uint16(chunk[12:14])
			bits := binary.LittleEndian.Uint16(chunk[14:16])
			width := int(bits / 8)
			if encoding != 1 || channels < 1 || rate == 0 || bits == 0 || bits%8 != 0 || width*channels != int(blockAlign) || uint64(rate)*uint64(blockAlign) != uint64(byteRate) {
				return pcmWAV{}, fmt.Errorf("unsupported or inconsistent PCM format")
			}
			result.rate, result.width, result.channels = int(rate), width, channels
			haveFormat = true
		case "data":
			if haveData || len(chunk) == 0 {
				return pcmWAV{}, fmt.Errorf("missing or duplicate audio data chunk")
			}
			result.data = chunk
			haveData = true
		}
		offset = paddedEnd
	}
	if !haveFormat || !haveData {
		return pcmWAV{}, fmt.Errorf("WAV is missing a format or data chunk")
	}
	if len(result.data)%(result.width*result.channels) != 0 {
		return pcmWAV{}, fmt.Errorf("PCM data ends in a partial frame")
	}
	return result, nil
}
