# @prism/typescript-configs

The TypeScript settings every package extends, so they type-check alike:

| File                   | For                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `tsconfig.base.json`   | Code that runs anywhere and uses no Node types, such as `@prism/shared`.                |
| `tsconfig.node.json`   | Code that runs in Node or Electron: the main process, the preload, the catalog, e2e.    |
| `tsconfig.client.json` | Code that runs in the window and uses the DOM and JSX: the renderer, the design system. |

A package's `tsconfig.json` extends one of them and adds only what is its own. Change a setting
here, not in a package, when every package should have it.
