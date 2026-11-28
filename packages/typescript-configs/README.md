# @prism/typescript-configs

The TypeScript settings every package extends, so they type-check alike:

| File                   | For                                                    |
| ---------------------- | ------------------------------------------------------ |
| `tsconfig.base.json`   | Code that runs anywhere and uses no Node types.        |
| `tsconfig.node.json`   | Code that runs in Node or Electron.                    |
| `tsconfig.client.json` | Code that runs in the window and uses the DOM and JSX. |

A package's `tsconfig.json` extends one of them and adds only what is its own. Change a setting
here, not in a package, when every package should have it.
