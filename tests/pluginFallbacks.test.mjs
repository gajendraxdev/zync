import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const marketplace = readFileSync('src/components/settings/Marketplace.tsx', 'utf8');
const start = marketplace.indexOf('const PluginImage =');
const end = marketplace.indexOf('export function Marketplace', start);
assert.ok(start >= 0 && end > start);
const { outputText } = ts.transpileModule(`${marketplace.slice(start, end)}\nglobalThis.renderImage = PluginImage;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});
// Each component has one hook; give it its own persistent state and real setter.
function createStateHook() {
    let initialized = false;
    let state;
    return initial => {
        if (!initialized) {
            state = typeof initial === 'function' ? initial() : initial;
            initialized = true;
        }
        return [state, next => {
            state = typeof next === 'function' ? next(state) : next;
        }];
    };
}

const context = {
    exports: {}, require, URL,
    useState: createStateHook(),
    IconResolver: () => null,
};
runInNewContext(outputText, context);
const thumbnail = 'https://example.com/icon.svg';
for (const icon of [undefined, '', '   ']) {
    const result = context.renderImage({ url: thumbnail, path: 'installed/plugin', localIcon: icon, icon: 'Plug', name: 'Plugin' });
    assert.equal(result.type, 'img', 'An installed path alone cannot suppress the thumbnail');
    assert.equal(result.props.src, thumbnail);
}
const local = context.renderImage({ url: thumbnail, path: 'installed/plugin', localIcon: 'icons/plugin.svg' });
assert.equal(local.type, 'div');
assert.equal(local.props.children.props.fallback.type, 'img');
assert.equal(local.props.children.props.fallback.props.src, thumbnail);
assert.equal(context.renderImage({ url: thumbnail, icon: 'Plug' }).type, 'img');
for (const url of ['http://example.com/icon.svg', 'https://user:password@example.com/icon.svg', 'invalid', undefined]) {
    assert.equal(context.renderImage({ url }).type, 'div', 'Unsafe thumbnails still use the icon fallback');
}
const thumbnailImage = context.renderImage({ url: thumbnail });
assert.equal(thumbnailImage.type, 'img');
thumbnailImage.props.onError();
assert.equal(context.renderImage({ url: thumbnail }).type, 'div', 'Failed thumbnails use the icon fallback');
const registryFallback = context.renderImage({ url: thumbnail, path: 'installed/plugin', icon: 'Activity' });
assert.equal(registryFallback.props.children.props.name, 'Activity');
assert.equal(registryFallback.props.children.props.path, undefined, 'Registry icons are not package-relative assets');

const assetSource = readFileSync('src/components/icons/PluginAssetIcon.tsx', 'utf8');
const assetStart = assetSource.indexOf('function AssetImage');
const assetEnd = assetSource.indexOf('export function PluginAssetIcon');
const assetCode = ts.transpileModule(`${assetSource.slice(assetStart, assetEnd)}\nglobalThis.renderAsset = AssetImage;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const assetContext = { exports: {}, require, useState: createStateHook() };
runInNewContext(assetCode, assetContext);
const fallback = local.props.children.props.fallback;
const assetProps = { src: 'asset://icon.svg', fallback };
const assetImage = assetContext.renderAsset(assetProps);
assert.equal(assetImage.type, 'img', 'Thumbnail failure does not affect a usable local image');
assetImage.props.onError();
assert.equal(assetContext.renderAsset(assetProps), fallback, 'The local image error handler renders the thumbnail');
assert.equal(context.renderImage({ url: thumbnail }).type, 'div', 'Local failure cannot reset thumbnail failure state');

const manager = readFileSync('src/components/terminal/TerminalManager.tsx', 'utf8');
assert.match(manager, /terminalView && selectedCanvas \? null : terminalView && pluginPanelId \? \(/);
assert.match(manager, /role="status"[\s\S]*?Preparing plugin pane/);
assert.doesNotMatch(manager, /terminalView && \(pluginPanelId \|\| selectedCanvas\) \? null/);
console.log('Plugin thumbnail and missing-canvas fallback tests passed.');
