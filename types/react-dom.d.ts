// Tipado mínimo de createPortal para compilar con npm ci sin dependencias extra.
// No implementa ni reemplaza el paquete react-dom real.
declare module 'react-dom' {
  import type { ReactNode, ReactPortal } from 'react';
  export function createPortal(children: ReactNode, container: Element | DocumentFragment, key?: string | null): ReactPortal;
}
