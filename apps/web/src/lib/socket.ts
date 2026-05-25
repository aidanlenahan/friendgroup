import { io, Socket } from 'socket.io-client'
import { resolveApiBaseUrl } from './api'

let _socket: Socket | null = null
let _refCount = 0

export function acquireSocket(): Socket {
  if (!_socket) {
    // VITE_API_BASE_URL is the canonical "which server" var set by deploy scripts
    // and takes priority. VITE_SOCKET_URL is the fallback for cases where the
    // socket server is on a different host than the REST API.
    const explicit = import.meta.env.VITE_API_BASE_URL
    const socketUrl =
      (explicit && explicit.startsWith('http') ? explicit : null) ??
      import.meta.env.VITE_SOCKET_URL ??
      (typeof window !== 'undefined' ? resolveApiBaseUrl() : '')
    _socket = io(socketUrl, {
      // withCredentials sends the HttpOnly auth cookie automatically.
      // The legacy auth.token field is omitted — cookie handles auth.
      withCredentials: true,
      // Start with polling so the connection works behind Cloudflare (which
      // sometimes drops the WS upgrade), then upgrade to WebSocket when able.
      transports: ['polling', 'websocket'],
    })
  }
  _refCount++
  return _socket
}

export function releaseSocket(): void {
  _refCount = Math.max(0, _refCount - 1)
  if (_refCount === 0) {
    _socket?.disconnect()
    _socket = null
  }
}
