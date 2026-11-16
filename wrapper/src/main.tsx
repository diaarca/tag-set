import { createRoot } from 'react-dom/client';
import { App } from '../../src/App.js';
import { api, setApiTransport } from '../../src/api.js';
import { LocalLibraryApi } from './api.js';
import { PortableCatalog } from './catalog.js';
import { request } from './host.js';
import { WrapperPlayer } from './Player.js';
import '../../src/style.css';
import './style.css';

const local = new LocalLibraryApi(
  {
    async read() {
      const value = await request('readLibrary');
      if (value !== null && typeof value !== 'string')
        throw new Error('The device returned an invalid library.');
      return value;
    },
    async write(data, previous) {
      await request('writeLibrary', { data, previous });
    },
  },
  new PortableCatalog((endpoint, body) =>
    request('catalog', { endpoint, body }),
  ),
);
setApiTransport((...args) => local.request(...args));
createRoot(document.getElementById('root')!).render(
  <App
    localLibrary
    PlayerComponent={WrapperPlayer}
    onExport={async () => {
      await request(
        'exportLibrary',
        JSON.stringify(await api('/library/export')),
      );
    }}
  />,
);
