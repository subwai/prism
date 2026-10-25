/** Images imported as URLs, which Vite serves and bundles. */
declare module '*.svg' {
  const url: string;
  export default url;
}
