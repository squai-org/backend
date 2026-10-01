# Cloudflare: operación y límites

Cuotas de **Workers Free y D1 Free**, verificadas en documentación oficial el **2026-10-01**. Son límites compartidos de plataforma; los detalles del negocio están en [cada módulo](../modules/index.md). El plan contratado y consumo real de la cuenta deben comprobarse en su dashboard.

## Cuotas gratuitas

| Recurso | Límite | Consecuencia relevante |
| --- | --- | --- |
| Workers: solicitudes | 100.000/día por cuenta | Al agotarse, el servicio deja de atender solicitudes del Worker |
| Workers: CPU HTTP | 10 ms por solicitud | Excederlo de forma sostenida termina la ejecución con error 1102 |
| Workers: memoria | 128 MB por isolate | Compartida entre solicitudes concurrentes; la sobrecarga puede cancelar solicitudes |
| D1: filas leídas | 5 millones/día | Se bloquean las consultas hasta el siguiente reinicio de cuota |
| D1: filas escritas | 100.000/día | Se bloquean las consultas hasta el siguiente reinicio de cuota |
| D1: almacenamiento | 500 MB/base; 5 GB/cuenta | Una base llena impide añadir datos o modificar su esquema |
| D1: bases y consultas | 10 bases/cuenta; 50 consultas/invocación | Restricciones al repartir datos o ejecutar lotes dentro de una solicitud |
| D1: Time Travel | 7 días | Ventana de recuperación; no sustituye una estrategia de respaldo |
| Static Assets | 20.000 archivos/versión; 25 MiB/archivo | Restricciones de publicación de recursos |
| Workers Logs | 200.000 eventos/día; retención de 3 días | La cobertura y el historial de observabilidad son limitados |

Las cuotas diarias de solicitudes y filas D1 reinician a las **00:00 UTC**. CPU mide ejecución, no espera de red o de D1; latencia HTTP y CPU son métricas distintas. No dependas de la tolerancia ocasional del runtime al límite de CPU.

Las filas leídas/escritas no equivalen al número de consultas. Escaneos e índices afectan el consumo; las escrituras de índices también cuentan. Consultas desde Wrangler o consola consumen cuota. Revisa `rows_read` y `rows_written` en los metadatos D1 para medir operaciones representativas.

Cada base D1 procesa consultas de forma secuencial. Una ráfaga puede producir sobrecarga antes de agotar las cuotas diarias.

## Recursos estáticos

Los recursos servidos directamente por Static Assets tienen solicitudes gratuitas ilimitadas y no cobran almacenamiento. Aquí [wrangler.json](../../wrangler.json) configura `run_worker_first: true`: se invoca primero el Worker y esas invocaciones consumen su cuota. Al agotarla, este modo puede devolver 429 sin servir el recurso. Una respuesta dinámica de un módulo no se convierte en recurso estático por su tipo de archivo.

## Operación sin cargos y continuidad

Mantener Workers/D1 en Free evita excedentes facturables de esos productos, pero agotar cuotas interrumpe servicio. No garantiza disponibilidad ilimitada ni elimina costos de productos adicionales contratados.

Estas son **recomendaciones operativas**, no controles ya implementados:

- Vigilar CPU p95/p99, `exceededCpu`, memoria, errores, solicitudes, filas D1 y tamaño de base.
- Reservar inicialmente un 20% de las cuotas para tráfico normal y otros módulos; es una política propuesta, no una cuota Cloudflare.
- Limitar concurrencia de lotes y reintentos. Usar backoff para fallos transitorios y detener el lote al alcanzar cuota; reintentar continuamente empeora el agotamiento.
- Revisar muestreo y retención de logs. La configuración actual habilita observabilidad; el muestreo predeterminado es 100% cuando no se especifica otro valor. No registrar datos personales ni secretos.
- Si se cambia a Paid, establecer un límite de CPU adecuado y revisar presupuestos. Las alertas de presupuesto notifican; no son un tope de gasto ni suspenden automáticamente el servicio.

No existe todavía un controlador global de cuotas, un ejecutor de lotes ni alertas de facturación configuradas por este repositorio. Para asegurar continuidad dentro de Free, la capacidad debe calcularse con consumo medido y margen antes de ejecutar lotes grandes.

## Fuentes oficiales

- [Workers: límites](https://developers.cloudflare.com/workers/platform/limits/)
- [D1: precios y conteo de filas](https://developers.cloudflare.com/d1/platform/pricing/)
- [D1: límites y concurrencia](https://developers.cloudflare.com/d1/platform/limits/)
- [Static Assets: facturación](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)
- [Workers Logs: precios y límites](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
- [Alertas de presupuesto](https://developers.cloudflare.com/billing/manage/budget-alerts/)
