import { getAppDirectory } from '@react-router/dev/routes';
import { remixRoutesOptionAdapter } from '@react-router/remix-routes-option-adapter';
import { flatRoutes } from 'remix-flat-routes';

export default remixRoutesOptionAdapter((defineRoutes) =>
  flatRoutes('routes', defineRoutes, {
    appDir: getAppDirectory(),
    ignoredRouteFiles: ['**/.*'],
  }),
);
