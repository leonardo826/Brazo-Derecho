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

const DECLARE_VERB =
  /\b(presenta|presentar|presentes|presentá|presenten|presentad|declara|declarar|declaro|declaren|declaramos|env[ií]a|enviar|manda|mandar|haz|hacer|realiza|realizar)\b/i;
const DECLARE_OBJECT = /\b(declaraci[oó]n(es)?|f22|f29|formulario\s*(22|29))\b/i;

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
  return DECLARE_VERB.test(goal) && DECLARE_OBJECT.test(goal);
}

export function isHighRiskGoal(goal: string) {
  return isPaymentGoal(goal) || isDeclarationGoal(goal);
}

export function isSensitiveGoal(goal: string) {
  return isSendGoal(goal) || isHighRiskGoal(goal);
}
