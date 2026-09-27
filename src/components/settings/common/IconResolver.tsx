import { type ComponentType } from 'react';
import { Activity, Cpu, Gauge, Globe, Layers, Lock, Monitor, Package, Plug, Settings as SettingsIcon, Shield, Terminal, Zap, FileText, Folder } from 'lucide-react';
import { PluginAssetIcon } from '../../icons/PluginAssetIcon';
import { isPluginImageIcon } from '../../../features/plugins/pluginIconPath';

interface IconResolverProps {
    name?: string;
    path?: string;
    size?: number;
    className?: string;
}

const icons: Record<string, ComponentType<{ size?: number; className?: string }>> = {
    Activity, Cpu, Gauge, Layers, Globe, Zap, Shield, Lock, Terminal, Package, Plug, FileText, Monitor, SettingsIcon, Folder
};

const iconAliases: Record<string, string> = {
    settings: 'SettingsIcon',
    setting: 'SettingsIcon',
    plugin: 'Plug',
    file: 'FileText',
};

const normalizeIconKey = (value: string): string => value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
    .replace(/icon$/, '');

const normalizedIcons = Object.entries(icons).reduce<Record<string, ComponentType<{ size?: number; className?: string }>>>((acc, [key, component]) => {
    const normalized = normalizeIconKey(key);
    if (!acc[normalized]) {
        acc[normalized] = component;
    }
    return acc;
}, {});

export function IconResolver({ name, path, size = 16, className = "" }: IconResolverProps) {
    if (isPluginImageIcon(name)) {
        return <PluginAssetIcon icon={name} pluginPath={path} size={size} className={className} />;
    }

    const resolvedName = (name || '').trim();
    const canonical = resolvedName.replace(/\s+/g, '');
    const separatorPascal = resolvedName
        .split(/[-_\s]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');
    const separatorCanonical = separatorPascal.replace(/\s+/g, '');
    const capitalized = canonical ? canonical.charAt(0).toUpperCase() + canonical.slice(1) : '';
    const normalized = canonical.toLowerCase();
    const aliasTarget = iconAliases[normalized];
    const candidateKeys = [
        resolvedName,
        canonical,
        `${canonical}Icon`,
        capitalized,
        `${capitalized}Icon`,
        separatorPascal,
        `${separatorPascal}Icon`,
        separatorCanonical,
        `${separatorCanonical}Icon`,
        separatorPascal.toLowerCase(),
        aliasTarget,
    ].filter((value): value is string => Boolean(value));
    const Icon = candidateKeys
        .map((key) => normalizedIcons[normalizeIconKey(key)])
        .find(Boolean)
        || Plug;
    return <Icon size={size} className={className} />;
}

export type { IconResolverProps };
