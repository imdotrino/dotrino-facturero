import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
// Botón «Instalar» PWA unificado (§3). La barra superior se importa en App.vue.
import '@dotrino/install'
import { createBackNav } from '@dotrino/nav'
import { registerSW } from 'virtual:pwa-register'

// SW con auto-actualización real: recarga al tomar control el SW nuevo y re-chequea
// cada 30 min (si no, la PWA instalada se queda en la versión vieja). Recargar a mitad de
// un envío no pierde nada: la factura se guarda firmada ANTES de enviarla, y reenviar una
// que el SRI ya recibió devuelve el aviso 43, que se trata como recibida.
registerSW({
  immediate: true,
  onRegisteredSW (_url, reg) {
    if (!reg) return
    setInterval(() => { reg.update().catch((e) => console.error('[facturero] sw update:', e)) }, 30 * 60_000)
  },
})

createBackNav()

createApp(App).mount('#app')
