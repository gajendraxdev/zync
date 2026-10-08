import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Plus } from 'lucide-react';
import { Button } from '../src/components/ui/Button';
import { Input } from '../src/components/ui/Input';
import '../src/index.css';
import './uiControls.browser.css';

/** Development-only fixtures: production components, no app store or native bridge. */
function ControlExamples({ theme }: { theme: 'dark' | 'light' }) {
  const [value, setValue] = useState('My workspace');
  const [submissions, setSubmissions] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  return <section className="control-gallery-panel" data-gallery-theme={theme} aria-label={`${theme} controls`}>
    <h2>{theme === 'dark' ? 'Dark' : 'Light'} theme</h2>
    <p>Theme fixtures use the existing app color contract.</p>
    <div className="control-gallery-row">
      <Button type="button" data-primary>Primary</Button>
      <Button type="button" variant="secondary">Secondary</Button>
      <Button type="button" variant="ghost">Ghost</Button>
      <Button type="button" variant="danger">Danger</Button>
    </div>
    <div className="control-gallery-row">
      <Button type="button" size="sm">Small</Button>
      <Button type="button" size="md" data-medium>Medium</Button>
      <Button type="button" size="lg">Large</Button>
      <Button type="button" size="icon" aria-label="Add item"><Plus size={16} /></Button>
    </div>
    <div className="control-gallery-row">
      <Button type="button" disabled>Disabled</Button>
      <Button type="button" isLoading data-loading>Saving</Button>
      <Button type="button" variant="secondary" className="h-7 rounded-none text-xs" data-compact>Caller override</Button>
    </div>
    <form onSubmit={event => { event.preventDefault(); setSubmissions(count => count + 1); }}>
      <Input ref={inputRef} id={`${theme}-name`} label="Workspace name" value={value} onChange={event => setValue(event.target.value)} data-standard />
      <Input id={`${theme}-invalid`} label="Required field" error="Enter a display name." aria-describedby={`${theme}-hint`} data-invalid />
      <p id={`${theme}-hint`}>This fixture does not rename any real workspace.</p>
      <Input label="Disabled field" value="Unavailable" disabled />
      <Input label="Read-only field" value="Readable, selectable text" readOnly />
      <Input label="Password" type={showPassword ? 'text' : 'password'} defaultValue="fixture only" rightElement={
        <button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? 'Hide' : 'Show'}</button>
      } />
      <Input label="Caller-sized field" className="h-7 rounded-none text-xs" placeholder="Compact override" data-compact-input />
      <div className="control-gallery-row">
        <Button type="button" variant="secondary" onClick={() => inputRef.current?.focus()}>Focus name</Button>
        <Button type="submit" data-submit>Submit fixture</Button>
      </div>
      <output aria-live="polite">Submissions: {submissions}</output>
    </form>
  </section>;
}

/** Check real computed styles and native behavior; throws on a failed contract. */
function runChecks(): string[] {
  const results: string[] = [];
  const check = (condition: boolean, message: string) => {
    if (!condition) throw new Error(message);
    results.push(`PASS ${message}`);
  };
  for (const theme of ['dark', 'light']) {
    const panel = document.querySelector<HTMLElement>(`[data-gallery-theme="${theme}"]`)!;
    const medium = panel.querySelector<HTMLButtonElement>('[data-medium]')!;
    const input = panel.querySelector<HTMLInputElement>('[data-standard]')!;
    const invalid = panel.querySelector<HTMLInputElement>('[data-invalid]')!;
    const compact = panel.querySelector<HTMLButtonElement>('[data-compact]')!;
    const compactInput = panel.querySelector<HTMLInputElement>('[data-compact-input]')!;
    const loading = panel.querySelector<HTMLButtonElement>('[data-loading]')!;
    check(getComputedStyle(medium).height === getComputedStyle(input).height, `${theme}: input/button height matches`);
    check(getComputedStyle(medium).borderRadius === getComputedStyle(input).borderRadius, `${theme}: input/button radius matches`);
    check(getComputedStyle(compact).height === '28px' && getComputedStyle(compactInput).height === '28px', `${theme}: caller height override`);
    check(getComputedStyle(compact).borderRadius === '0px', `${theme}: caller radius override`);
    check(loading.disabled && loading.getAttribute('aria-busy') === 'true', `${theme}: loading semantics`);
    let clicks = 0;
    const onClick = () => { clicks++; };
    loading.addEventListener('click', onClick);
    loading.click();
    loading.removeEventListener('click', onClick);
    check(clicks === 0, `${theme}: loading blocks native click`);
    check(invalid.getAttribute('aria-invalid') === 'true', `${theme}: validation state`);
    check((invalid.getAttribute('aria-describedby') ?? '').split(' ').every(id => document.getElementById(id)), `${theme}: description targets exist`);
    input.focus();
    check(document.activeElement === input, `${theme}: input focus`);
    const primary = panel.querySelector<HTMLButtonElement>('[data-primary]')!;
    const before = getComputedStyle(primary).backgroundColor;
    // Disable transitions while observing a live subtree theme override.
    const previousTransition = primary.style.transition;
    try {
      primary.style.transition = 'none';
      panel.style.setProperty('--color-app-accent', '#123456');
      check(getComputedStyle(primary).backgroundColor === 'rgb(18, 52, 86)', `${theme}: live scoped theme color`);
      panel.style.removeProperty('--color-app-accent');
      check(getComputedStyle(primary).backgroundColor === before, `${theme}: theme restoration`);
    } finally {
      panel.style.removeProperty('--color-app-accent');
      primary.style.transition = previousTransition;
    }
  }
  return results;
}

function Gallery() {
  const [results, setResults] = useState('Ready. Run checks, then inspect keyboard focus and visual states.');
  return <main className="control-gallery">
    <header>
      <h1>Zync control foundation</h1>
      <p>Development gallery · Button and Input · No application data is accessed.</p>
      <Button type="button" onClick={() => {
        try { setResults(runChecks().join('\n')); }
        catch (error) { setResults(`FAIL ${error instanceof Error ? error.message : String(error)}`); }
      }}>Run browser checks</Button>
      <p role="status">{results.startsWith('PASS') ? 'All 22 browser checks passed.' : results}</p>
      <details><summary>Check details</summary><pre data-check-results>{results}</pre></details>
    </header>
    <div className="control-gallery-grid"><ControlExamples theme="dark" /><ControlExamples theme="light" /></div>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Gallery />);
