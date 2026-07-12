/* @flow */

// load environment listeners
import './environment/background/ajax';
import './environment/background/auth';
import './environment/background/download';
import './environment/background/history';
import './environment/background/i18n';
import './environment/background/loadScript';
import { addListener } from './environment/background/messaging';
import './environment/background/multicast';
import './environment/background/pageAction';
import './environment/background/permissions';
import './environment/background/session';
import './environment/background/storage';
import './environment/background/tabs';
import './environment/background/telemetryBlocker';
import './environment/background/xhrCache';

addListener('runMigrations', () => undefined);
