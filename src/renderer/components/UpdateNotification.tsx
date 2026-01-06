import { useEffect, useState } from 'react';
import { RefreshCw, Download, AlertTriangle } from 'lucide-react';
import { Button } from './ui/Button';

export function UpdateNotification() {
    const [status, setStatus] = useState<'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'>('idle');
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState('');

    useEffect(() => {
        const onUpdateAvailable = () => setStatus('available');
        const onUpdateProgress = (_: any, p: any) => {
            setStatus('downloading');
            setProgress(p.percent);
        };
        const onUpdateDownloaded = () => setStatus('ready');
        const onUpdateError = (_: any, message: string) => {
            setStatus('error');
            setError(message);
        };

        window.ipcRenderer.on('update:available', onUpdateAvailable);
        window.ipcRenderer.on('update:progress', onUpdateProgress);
        window.ipcRenderer.on('update:downloaded', onUpdateDownloaded);
        window.ipcRenderer.on('update:error', onUpdateError);

        return () => {
            window.ipcRenderer.off('update:available', onUpdateAvailable);
            window.ipcRenderer.off('update:progress', onUpdateProgress);
            window.ipcRenderer.off('update:downloaded', onUpdateDownloaded);
            window.ipcRenderer.off('update:error', onUpdateError);
        };
    }, []);

    const installUpdate = () => {
        window.ipcRenderer.invoke('update:install');
    };

    if (status === 'idle' || status === 'checking') return null;

    return (
        <div className="fixed bottom-4 right-4 z-50 max-w-sm w-full animate-in slide-in-from-bottom-5 duration-300">
            <div className="bg-app-panel border border-app-border rounded-xl shadow-lg p-4 backdrop-blur-xl bg-opacity-95">
                <div className="flex items-start gap-3">
                    <div className="p-2 bg-app-accent/10 rounded-lg text-app-accent">
                        {status === 'downloading' ? <Download size={20} className="animate-bounce" /> :
                         status === 'ready' ? <RefreshCw size={20} /> :
                         status === 'error' ? <AlertTriangle size={20} className="text-red-500" /> :
                         <Download size={20} />}
                    </div>
                    <div className="flex-1">
                        <h4 className="text-sm font-semibold text-app-text mb-1">
                            {status === 'available' && 'New Update Available'}
                            {status === 'downloading' && 'Downloading Update...'}
                            {status === 'ready' && 'Update Ready to Install'}
                            {status === 'error' && 'Update Failed'}
                        </h4>
                        
                        <p className="text-xs text-app-muted mb-3">
                            {status === 'available' && 'A new version of Zync is available.'}
                            {status === 'downloading' && `${Math.round(progress)}% downloaded`}
                            {status === 'ready' && 'Restart now to apply the update.'}
                            {status === 'error' && error}
                        </p>

                        {status === 'downloading' && (
                            <div className="h-1 w-full bg-app-surface rounded-full overflow-hidden mb-2">
                                <div 
                                    className="h-full bg-app-accent transition-all duration-300"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                        )}

                        <div className="flex justify-end gap-2">
                            {status === 'ready' && (
                                <Button size="sm" onClick={installUpdate} className="w-full">
                                    Restart & Install
                                </Button>
                            )}
                            {status === 'error' && (
                                <button 
                                    onClick={() => setStatus('idle')}
                                    className="text-xs text-app-muted hover:text-app-text transition-colors"
                                >
                                    Dismiss
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
