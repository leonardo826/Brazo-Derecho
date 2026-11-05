const BULK = [
  /masiv/i,
  /difusi[oó]n/i,
  /\bbroadcast\b/i,
  /todos los contactos/i,
  /a todos\b/i,
  /cada contacto/i,
];

const SENSITIVE = [
  /\benviar\b/i,
  /\benv[ií]a\b/i,
  /\bmand(ar|a|ale|arle)\b/i,
  /\bm[aá]nd(a|ale|arle)\b/i,
  /\bsend\b/i,
  /\bmessage\b/i,
  /\bpag(ar|a|o|os|ue)\b/i,
  /\bpay\b/i,
  /\bpayment\b/i,
  /\btransfer(ir|encia|encias)\b/i,
];

export function isBulkGoal(goal: string) {
  return BULK.some((pattern) => pattern.test(goal));
}

export function isSensitiveGoal(goal: string) {
  return SENSITIVE.some((pattern) => pattern.test(goal));
}
