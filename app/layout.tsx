import './globals.css';
import type {Metadata} from 'next';
export const metadata:Metadata={title:'Chat y panel | TicketBridge',description:'Simulador seguro de tickets para Jira CW'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="es"><body>{children}</body></html>}
