import { Fragment, type ReactNode } from 'react';
import { visibleChromeActions, type ChromeActionArea, type ChromeActionId } from '../../features/workspace/domain/chromeActions';

/** Project stable keyed action slots only; callbacks, availability and subscriptions belong to callers. */
export function ChromeActionItems({ value, area, slots }: {
    value: unknown; area: ChromeActionArea; slots: Partial<Record<ChromeActionId, ReactNode>>;
}) {
    return <>{visibleChromeActions(value, area).map(id => <Fragment key={id}>{slots[id]}</Fragment>)}</>;
}
