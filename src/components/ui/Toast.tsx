import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, X, AlertTriangle, Info as InfoIcon } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
    id: string;
    message: string;
    type: ToastType;
}

let toastId = 0;
let showToastFn: ((message: string, type: ToastType) => void) | null = null;

export function showToast(message: string, type: ToastType = 'success') {
    if (showToastFn) {
        showToastFn(message, type);
    }
}

export function ToastContainer() {
    const [toasts, setToasts] = useState<Toast[]>([]);

    useEffect(() => {
        showToastFn = (message: string, type: ToastType) => {
            const id = `toast-${toastId++}`;
            setToasts(prev => [...prev, { id, message, type }]);

            setTimeout(() => {
                setToasts(prev => prev.filter(t => t.id !== id));
            }, 3000);
        };

        return () => {
            showToastFn = null;
        };
    }, []);

    if (toasts.length === 0) return null;

    return createPortal(
        <div className="fixed top-4 right-4 z-[10000] flex flex-col gap-2 pointer-events-none">
            {toasts.map(toast => (
                <div
                    key={toast.id}
                    className={`
                        pointer-events-auto min-w-[300px] p-4 rounded-lg shadow-2xl border backdrop-blur-md
                        animate-in slide-in-from-top-2 fade-in duration-200
                        ${toast.type === 'success' ? 'bg-green-500/10 border-green-500/30 text-green-400' : ''}
                        ${toast.type === 'error' ? 'bg-red-500/10 border-red-500/30 text-red-400' : ''}
                        ${toast.type === 'warning' ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400' : ''}
                        ${toast.type === 'info' ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' : ''}
                    `}
                >
                    <div className="flex items-center gap-3">
                        {toast.type === 'success' && <Check className="w-5 h-5 shrink-0" />}
                        {toast.type === 'error' && <X className="w-5 h-5 shrink-0" />}
                        {toast.type === 'warning' && <AlertTriangle className="w-5 h-5 shrink-0" />}
                        {toast.type === 'info' && <InfoIcon className="w-5 h-5 shrink-0" />}
                        <span className="text-sm font-medium flex-1">{toast.message}</span>
                    </div>
                </div>
            ))}
        </div>,
        document.body
    );
}
