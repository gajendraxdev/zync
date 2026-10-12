import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '../src/components/ui/Button';
import { Input } from '../src/components/ui/Input';
import { Select } from '../src/components/ui/Select';
import { Modal } from '../src/components/ui/Modal';
import { ContextMenu } from '../src/components/ui/ContextMenu';
import { TopbarDropdown } from '../src/components/ui/TopbarDropdown';
import { MENU_ITEM_CLASSES } from '../src/components/ui/surfaceStyles';
import { Provider as TooltipProvider } from '@radix-ui/react-tooltip';
import { SidebarSection } from '../src/components/layout/sidebar/SidebarSection';
import { SidebarActionButton } from '../src/components/layout/sidebar/SidebarActionButton';
import { SplitSidebarActionButton } from '../src/components/layout/sidebar/SplitSidebarActionButton';
import { ConnectionItem } from '../src/components/layout/sidebar/ConnectionItem';
import { useAppStore, type Connection } from '../src/store/useAppStore';
import { Server, Shield } from 'lucide-react';
import '../src/index.css';
import './uiOverlays.browser.css';

const options = [
  { value: 'sh', label: 'Shell', description: 'Default shell' },
  { value: 'bash', label: 'Bash', description: 'Bourne Again Shell' },
  { value: 'pwsh', label: 'PowerShell', description: 'Cross-platform shell' },
];

const fixtureHost: Connection = { id: 'sidebar-fixture', name: 'Fixture host', host: 'example.invalid',
  username: 'fixture', port: 22, status: 'connected' };

function SidebarControlsFixture() {
  const [actions, setActions] = useState({ opened: 0, edited: 0, disconnected: 0, created: 0 });
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const { openTab, disconnect } = useAppStore.getState();
    // In-memory callbacks only; this page never connects/disconnects a real host.
    useAppStore.setState({
      openTab: () => setActions(value => ({ ...value, opened: value.opened + 1 })),
      disconnect: async () => { setActions(value => ({ ...value, disconnected: value.disconnected + 1 })); },
    });
    return () => { useAppStore.setState({ openTab, disconnect }); };
  }, []);
  return <section aria-label="Sidebar controls" className="mt-6 max-w-sm">
    <h2>Sidebar controls</h2>
    <div className="overflow-hidden rounded-lg bg-app-panel p-1">
      <SidebarSection title="All Hosts" count={102} variant="action" icon={<Server size={14} />}
        createMenu={[{ id: 'host', label: 'New fixture host', onSelect: () => setActions(value => ({ ...value, created: value.created + 1 })) }]}>
        <ConnectionItem conn={fixtureHost} isCollapsed={false}
          onEdit={() => setActions(value => ({ ...value, edited: value.edited + 1 }))} onOpenContextMenu={() => {}} />
      </SidebarSection>
      <SidebarActionButton label="Forwarding fixture" icon={<Server size={14} />} onClick={() => {}} />
      <SplitSidebarActionButton label="Vault fixture" icon={<Shield size={14} />} expanded={expanded}
        toggleAriaLabel="Toggle vault fixture" badge={3} badgeTitle="3 unsecured fixture hosts"
        onPrimaryClick={() => {}} onToggleClick={() => setExpanded(value => !value)} />
    </div>
    <output aria-label="Sidebar action counts">Opened: {actions.opened}; edited: {actions.edited}; disconnected: {actions.disconnected}; created: {actions.created}</output>
  </section>;
}

/** Isolated overlay fixtures exercise production portals without app data or native IPC. */
function Gallery() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [shell, setShell] = useState('sh');
  const [modal, setModal] = useState<'normal' | 'explicit' | 'autofocus' | 'hidden-controls' | 'no-controls' | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [topbarOpen, setTopbarOpen] = useState(false);
  const [anchoredOpen, setAnchoredOpen] = useState(false);
  const anchoredTrigger = useRef<HTMLButtonElement>(null);
  const [actions, setActions] = useState(0);
  const recordAction = () => setActions(value => value + 1);
  useEffect(() => {
    // Body ownership is limited to this standalone fixture; body portals inherit it.
    document.body.dataset.overlayGalleryTheme = theme;
    return () => { delete document.body.dataset.overlayGalleryTheme; };
  }, [theme]);

  return <main className="overlay-gallery">
    <h1>Zync dropdowns and dialogs</h1>
    <p>Development fixtures. No real connections, commands or settings are changed.</p>
    <div className="overlay-gallery-actions">
      <Button type="button" variant="secondary" onClick={() => setTheme(value => value === 'dark' ? 'light' : 'dark')}>Use {theme === 'dark' ? 'light' : 'dark'} theme</Button>
      <output aria-live="polite">Actions: {actions}; selected: {shell}</output>
    </div>
    <div className="flex justify-end">
      <Button ref={anchoredTrigger} type="button" variant="secondary" aria-expanded={anchoredOpen}
        onClick={() => setAnchoredOpen(value => !value)}>Toggle anchored profile popup</Button>
      {anchoredOpen && <TopbarDropdown anchor={anchoredTrigger.current} align="right" widthClass="w-64"
        role="menu" aria-label="Anchored profile actions">
        <button type="button" role="menuitem" className={`${MENU_ITEM_CLASSES} w-full hover:bg-app-surface`}
          onClick={() => { recordAction(); setAnchoredOpen(false); }}>Profile fixture action</button>
      </TopbarDropdown>}
    </div>
    <SidebarControlsFixture />
    <div className="overlay-gallery-grid">
      <section>
        <h2>Dropdowns</h2>
        <Select label="Inline shell" value={shell} options={options} onChange={setShell} />
        <Select label="Portal shell" value={shell} options={options} onChange={setShell} portal />
        <Select label="No search" value={shell} options={options} onChange={setShell} showSearch={false} />
        <Select label="Disabled shell" value={shell} options={options} onChange={setShell} disabled />
        <Select label="Compact shell" value={shell} options={options} onChange={setShell} triggerClassName="h-7 rounded-none text-xs" />
      </section>
      <section>
        <h2>Menus and dialogs</h2>
        <div className="relative">
          <Button type="button" variant="secondary" aria-expanded={topbarOpen} onClick={() => setTopbarOpen(value => !value)}>Toggle toolbar popup</Button>
          {topbarOpen && <TopbarDropdown role="menu" aria-label="Toolbar actions">
            <button type="button" role="menuitem" className={`${MENU_ITEM_CLASSES} w-full hover:bg-app-surface`} onClick={() => { recordAction(); setTopbarOpen(false); }}>Toolbar action</button>
          </TopbarDropdown>}
        </div>
        <Button type="button" variant="secondary" onClick={event => {
          const rect = event.currentTarget.getBoundingClientRect();
          setMenu({ x: rect.left, y: rect.bottom + 6 });
        }}>Open context menu</Button>
        <Button type="button" onClick={() => setModal('normal')}>Open dialog</Button>
        <Button type="button" variant="secondary" onClick={() => setModal('explicit')}>Open protected dialog</Button>
        <Button type="button" variant="secondary" onClick={() => setModal('autofocus')}>Open auto-focus dialog</Button>
        <Button type="button" variant="secondary" onClick={() => setModal('hidden-controls')}>Open hidden-controls dialog</Button>
        <Button type="button" variant="secondary" onClick={() => setModal('no-controls')}>Open no-controls dialog</Button>
        <p>Check Escape, outside dismissal, focus restoration, search, selection and nested menus.</p>
      </section>
    </div>
    {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} items={[
      { label: 'Record action', action: recordAction },
      { label: 'Unavailable action', action: recordAction, disabled: true },
      { label: 'More actions', children: [{ label: 'Nested action', action: recordAction }] },
      { separator: true },
      { label: 'Danger action', variant: 'danger', action: recordAction },
    ]} />}
    <Modal isOpen={modal !== null} onClose={() => setModal(null)} title={modal === 'explicit' ? 'Protected dialog' : 'Overlay test dialog'}
      subtitle="This fixture never changes application data." explicitDismissOnly={modal === 'explicit'}
      showCloseButton={modal !== 'hidden-controls' && modal !== 'no-controls'}>
      <div className="overlay-gallery-form">
        {(modal === 'hidden-controls' || modal === 'no-controls') && <>
          <input type="hidden" value="fixture" readOnly />
          <button type="button" hidden>Hidden button</button>
          <div style={{ display: 'none' }}><button type="button">Display-none ancestor</button></div>
          <button type="button" style={{ visibility: 'hidden' }}>Invisible button</button>
          <div inert><button type="button">Inert button</button></div>
          <fieldset disabled><button type="button">Disabled by fieldset</button></fieldset>
          <button type="button" tabIndex={-1}>Excluded from Tab order</button>
        </>}
        {modal === 'no-controls' ? <p>No tabbable controls. Escape dismisses this fixture.</p> : <>
          <Input label="Display name" defaultValue="Fixture" autoFocus={modal === 'autofocus'} />
          <Select label="Dialog shell" value={shell} options={options} onChange={setShell} portal />
          <Button type="button" onClick={() => setModal(null)}>Finish dialog</Button>
        </>}
      </div>
    </Modal>
  </main>;
}

createRoot(document.getElementById('root')!).render(<TooltipProvider delayDuration={120}><Gallery /></TooltipProvider>);
