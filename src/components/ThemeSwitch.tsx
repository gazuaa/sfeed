import { Sun, Moon } from 'lucide-react';
import type { ThemeMode } from '../client/api';

export function ThemeSwitch({ theme, onChange }: { theme: ThemeMode; onChange: (theme: ThemeMode) => void }) {
  return <div role="group" aria-label="화면 모드" className={`inline-flex shrink-0 items-center gap-0.5 rounded-xl border p-0.5 ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'}`}>
    {(['light', 'dark'] as const).map((value) => {
      const active = theme === value;
      const Icon = value === 'light' ? Sun : Moon;
      return <button key={value} type="button" aria-label={value === 'light' ? '낮 모드' : '밤 모드'} title={value === 'light' ? '낮 모드' : '밤 모드'} aria-pressed={active} onClick={() => { if (!active) onChange(value); }} className={`inline-flex items-center justify-center rounded-lg px-2.5 py-1.5 transition cursor-pointer ${active ? theme === 'dark' ? 'bg-slate-700 text-white shadow-sm' : 'bg-white text-slate-900 shadow-sm' : theme === 'dark' ? 'text-slate-400 hover:text-white' : 'text-slate-600 hover:text-slate-950'}`}><Icon size={14} aria-hidden="true" /></button>;
    })}
  </div>;
}
