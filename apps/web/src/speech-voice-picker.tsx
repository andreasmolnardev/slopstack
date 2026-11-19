import type { PiperHealth } from './api/learning-queries';

export function SpeechVoicePicker({ health, value, speaker, onChange, disabled = false }: {
  health?: PiperHealth;
  value: string;
  speaker: string;
  onChange: (voice: string, speaker: string) => void;
  disabled?: boolean;
}) {
  if (!health?.configured) return <p className="text-xs text-[#b7adcc]">Piper is not configured. Read the script or lesson here; speech playback is unavailable.</p>;
  if (!health.connected) return <p role="status" className="text-xs text-[#b7adcc]">Piper is configured but unavailable. Check the server’s Wyoming Piper endpoint.</p>;
  const voices = health.voices ?? [];
  const selectedVoice = voices.find(voice => voice.name === value);
  return <div className="grid gap-2 text-sm">
    <p role="status" className="text-xs text-[#b7adcc]">Piper connected{typeof health.latency_ms === 'number' ? ` · service discovery ${health.latency_ms} ms` : ''}.</p>
    {voices.length > 0 ? <label className="grid max-w-lg gap-1">Voice
      <select aria-label="Piper voice" value={value} disabled={disabled} onChange={event => onChange(event.target.value, '')} className="rounded-lg bg-[#0e0621] p-2">
        <option value="">Service default</option>
        {value && !selectedVoice && <option value={value} disabled>{value} · no longer advertised</option>}
        {voices.map(voice => <option key={voice.name} value={voice.name} disabled={voice.installed === false}>
          {voice.name}{voice.languages?.length ? ` · ${voice.languages.join(', ')}` : ''}{voice.installed === false ? ' · not installed' : ''}
        </option>)}
      </select>
      {voices.find(voice => voice.name === value)?.description && <span className="text-xs text-[#b7adcc]">{voices.find(voice => voice.name === value)?.description}</span>}
      {selectedVoice?.speakers?.length ? <label className="grid gap-1 text-xs">Speaker
        <select aria-label="Piper speaker" value={speaker} disabled={disabled} onChange={event => onChange(value, event.target.value)} className="rounded-lg bg-[#0e0621] p-2">
          <option value="">Service default</option>
          {voices.find(voice => voice.name === value)?.speakers?.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}
        </select>
      </label> : null}
    </label> : <><p className="text-xs text-[#b7adcc]">This service does not advertise voice choices; its configured default will be used.</p>{value && <button type="button" disabled={disabled} onClick={() => onChange('', '')} className="w-fit rounded border border-white/15 px-2 py-1 text-xs">Use service default</button>}</>}
  </div>;
}
