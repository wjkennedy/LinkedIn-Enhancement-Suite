/* @flow */

import * as Storage from '../../environment/foreground/storage';

export const storage = Storage.wrapBlob('LES.modulePrefs',
	(): boolean => { throw new Error('Default module enabled state should never be accessed'); });

export function setEnabled(moduleId: string, enable: boolean) {
	return storage.set(moduleId, enable);
}
