const BULK = [
  /masiv/i,
  /difusi[oó]n/i,
  /\bbroadcast\b/i,
  /todos los contactos/i,
  /a todos\b/i,
  /cada contacto/i,
];

const SEND = [
  /\benviar\b/i,
  /\benv[ií]a\b/i,
  /\bmand(ar|a|ale|arle)\b/i,
  /\bm[aá]nd(a|ale|arle)\b/i,
  /\bsend\b/i,
  /\bmessage\b/i,
];

const PAYMENT = [
  /\bpag(ar|a|o|os|ue)\b/i,
  /\bpay\b/i,
  /\bpayment\b/i,
  /\btransfer(ir|encia|encias)\b/i,
];

const DECLARATION = [
  /declaraci[oó]n(es)?/i,
  /\bdeclar(ar|a|o|en|amos)\b/i,
  /formulario\s*(22|29)\b/i,
  /\bf(22|29)\b/i,
];

export function isBulkGoal(goal: string) {
  return BULK.some((pattern) => pattern.test(goal));
}

export function isSendGoal(goal: string) {
  return SEND.some((pattern) => pattern.test(goal));
}

export function isPaymentGoal(goal: string) {
  return PAYMENT.some((pattern) => pattern.test(goal));
}

export function isDeclarationGoal(goal: string) {
  return DECLARATION.some((pattern) => pattern.test(goal));
}

export function isHighRiskGoal(goal: string) {
  return isPaymentGoal(goal) || isDeclarationGoal(goal);
}

export function isSensitiveGoal(goal: string) {
  return isSendGoal(goal) || isHighRiskGoal(goal);
}
