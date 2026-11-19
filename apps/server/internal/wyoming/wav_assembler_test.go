package wyoming

import (
	"encoding/binary"
	"strings"
	"testing"
)

func TestAssembleWAVConcatenatesSegmentsWithAncillaryChunks(t *testing.T) {
	first := wav([]byte{1, 2, 3, 4}, 22050, 2, 1)
	first = addOddChunk(first, "JUNK", []byte{9})
	second := wav([]byte{5, 6, 7, 8}, 22050, 2, 1)
	joined, err := AssembleWAV([][]byte{first, second}, 128)
	if err != nil {
		t.Fatal(err)
	}
	pcm, rate, width, channels, err := ParseWAV(joined)
	if err != nil {
		t.Fatal(err)
	}
	if string(pcm) != string([]byte{1, 2, 3, 4, 5, 6, 7, 8}) || rate != 22050 || width != 2 || channels != 1 {
		t.Fatalf("unexpected assembled audio: pcm=%v format=%d/%d/%d", pcm, rate, width, channels)
	}
	if binary.LittleEndian.Uint32(joined[4:8]) != uint32(len(joined)-8) || binary.LittleEndian.Uint32(joined[40:44]) != 8 {
		t.Fatalf("WAV sizes were not updated: riff=%d data=%d output=%d", binary.LittleEndian.Uint32(joined[4:8]), binary.LittleEndian.Uint32(joined[40:44]), len(joined))
	}
}

func TestAssembleWAVRejectsMismatchedFormats(t *testing.T) {
	tests := []struct {
		name   string
		first  []byte
		second []byte
	}{
		{"sample rate", wav([]byte{1, 2}, 16000, 2, 1), wav([]byte{1, 2}, 22050, 2, 1)},
		{"sample width", wav([]byte{1, 2}, 16000, 2, 1), wav([]byte{1, 2}, 16000, 1, 1)},
		{"channels", wav([]byte{1, 2}, 16000, 2, 1), wav([]byte{1, 2, 3, 4}, 16000, 2, 2)},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := AssembleWAV([][]byte{test.first, test.second}, 1024); err == nil || !strings.Contains(err.Error(), "mismatched") {
				t.Fatalf("expected format mismatch, got %v", err)
			}
		})
	}
}

func TestAssembleWAVRejectsMalformedAndNonPCMSegments(t *testing.T) {
	valid := wav([]byte{1, 2, 3, 4}, 16000, 2, 1)
	badRIFFSize := append([]byte(nil), valid...)
	badRIFFSize[4] = 0
	truncatedChunk := append([]byte(nil), valid...)
	truncatedChunk[40] = 0xff
	nonPCM := append([]byte(nil), valid...)
	nonPCM[20] = 3
	for _, test := range []struct {
		name string
		data []byte
	}{{"RIFF size", badRIFFSize}, {"chunk size", truncatedChunk}, {"encoding", nonPCM}, {"short header", valid[:8]}} {
		t.Run(test.name, func(t *testing.T) {
			if _, err := AssembleWAV([][]byte{test.data}, 1024); err == nil {
				t.Fatal("expected invalid WAV to be rejected")
			}
		})
	}
}

func TestAssembleWAVEnforcesCompleteOutputLimit(t *testing.T) {
	segment := wav([]byte{1, 2, 3, 4}, 16000, 2, 1)
	if _, err := AssembleWAV([][]byte{segment}, len(segment)-1); err == nil || !strings.Contains(err.Error(), "limit") {
		t.Fatalf("expected complete output size limit error, got %v", err)
	}
	if _, err := AssembleWAV([][]byte{segment, segment}, len(segment)); err == nil {
		t.Fatal("assembled output larger than the limit should fail")
	}
}

func addOddChunk(input []byte, name string, data []byte) []byte {
	result := append([]byte(nil), input[:36]...)
	result = append(result, name...)
	var size [4]byte
	binary.LittleEndian.PutUint32(size[:], uint32(len(data)))
	result = append(result, size[:]...)
	result = append(result, data...)
	result = append(result, 0)
	result = append(result, input[36:]...)
	binary.LittleEndian.PutUint32(result[4:8], uint32(len(result)-8))
	return result
}
