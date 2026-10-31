"use client";

import { useState } from "react";
import { createQuoteAction } from "@/app/actions/quotes";
import { CsrfField } from "@/components/csrf-field";

export function QuoteForm({ items }: { items: { id: string; label: string }[] }) {
  const [rows, setRows] = useState(1);
  return (
    <form action={createQuoteAction} className="stack" autoComplete="off">
      <CsrfField />
      <label>
        Cliente
        <input name="customerName" required minLength={2} maxLength={120} placeholder="Nombre del cliente" autoComplete="off" />
      </label>
      <label>
        Notas internas
        <textarea name="notes" maxLength={1000} placeholder="Algo que deba saber quien aprueba. No se envía sola." autoComplete="off" />
      </label>
      <label>
        Pedido en texto
        <textarea
          name="pedidoLibre"
          placeholder="Escribe cantidades y productos tal como están en tu lista"
          autoComplete="off"
        />
      </label>
      <p className="muted">
        El texto se compara con tu lista. Si un producto no está, no entra y no se inventa el precio.
      </p>
      {Array.from({ length: rows }, (_, index) => (
        <div className="split" key={index}>
          <label>
            {`Producto de la lista, línea ${index + 1}`}
            <select name="priceItemId" defaultValue="">
              <option value="">Elegir de la lista</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {`Cantidad, línea ${index + 1}`}
            <input name="quantity" type="number" min={1} max={999} defaultValue={1} />
          </label>
        </div>
      ))}
      <div className="inline">
        <button
          className="button secondary"
          type="button"
          onClick={() => setRows((value) => Math.min(12, value + 1))}
        >
          Agregar línea
        </button>
        <button className="button" type="submit">
          Armar cotización
        </button>
      </div>
    </form>
  );
}
