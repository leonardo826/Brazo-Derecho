export function PaymentProviderField({
  flowTest,
  mercadoPagoTest,
}: {
  flowTest: boolean;
  mercadoPagoTest: boolean;
}) {
  return (
    <fieldset className="pay-with">
      <legend>Pagar con</legend>
      <label className="check">
        <input type="radio" name="provider" value="flow" defaultChecked />
        <span>Flow{flowTest ? " (modo prueba)" : ""}</span>
      </label>
      <label className="check">
        <input type="radio" name="provider" value="mercadopago" />
        <span>Mercado Pago{mercadoPagoTest ? " (modo prueba)" : ""}</span>
      </label>
    </fieldset>
  );
}
