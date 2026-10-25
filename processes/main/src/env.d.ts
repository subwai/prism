/// <reference types="electron-vite/node" />

/** Files imported as text, which electron-vite inlines into the build. */
declare module '*?raw' {
  const text: string;
  export default text;
}
