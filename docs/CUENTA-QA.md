# Cuenta QA interna

La cuenta QA existe solo para pruebas internas de Brazo Derecho. No es un cliente y no se factura.

`QA_LOGIN_EMAIL` y `QA_LOGIN_PASSWORD` viven como Secret en Vercel Production. No van en el repositorio. El primer ingreso con ese correo y esa clave crea o actualiza en Neon al usuario «QA Interno», la empresa `qa-interno` («QA Interno Brazo Derecho») y una suscripción del Contador activa por cerca de un año. La empresa queda con `isQa`. Con eso se puede usar el Contador —chat, voz y bóveda— en producción.

Esa marca saca a la empresa de los metros de cobro, de los eventos de uso que alimentan el precio y de cualquier preapproval de Mercado Pago o cobro de Flow. Un ingreso con otro correo sigue el login de siempre.
