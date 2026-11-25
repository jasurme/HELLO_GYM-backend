// Card entry for the three online checkouts: joining, buying or renewing a
// membership, and paying for a training session.
//
// This is the demo gateway's front end. No real payment is taken and the
// number is never stored: the fields are checked for shape only (16 digits, a
// future MM/YY, a 3-digit code), and src/lib/validate.js checks the same shape
// again on the server before the payment row is written.
import { html, $ } from './app.js';

const digits = (value) => String(value ?? '').replace(/\D/g, '');

// A card that always "works" in the demo, shown as the placeholder hint.
export const DEMO_CARD = '4242 4242 4242 4242';

const FIELDS = ['cardNumber', 'cardExpiry', 'cardCvc'];

// The markup, dropped into a checkout panel or modal body.
export function cardFields() {
  return html`
    <div class="card-fields" data-card-fields>
      <div class="d-flex align-items-center gap-2 mb-2">
        <span class="fw-semibold"><i class="bi bi-credit-card-2-front me-2 text-brand"></i>Card details</span>
        <span class="badge rounded-pill bg-secondary-subtle text-secondary-emphasis border border-secondary-subtle ms-auto">Demo · no real payment</span>
      </div>
      <div class="row g-2">
        <div class="col-12">
          <label class="form-label small mb-1" for="cardNumber">Card number</label>
          <input class="form-control" id="cardNumber" name="cardNumber" type="text" inputmode="numeric"
                 autocomplete="cc-number" placeholder="1234 5678 9012 3456" maxlength="19" spellcheck="false">
          <div class="invalid-feedback" data-error="cardNumber"></div>
        </div>
        <div class="col-6">
          <label class="form-label small mb-1" for="cardExpiry">Expiry</label>
          <input class="form-control" id="cardExpiry" name="cardExpiry" type="text" inputmode="numeric"
                 autocomplete="cc-exp" placeholder="MM/YY" maxlength="5" spellcheck="false">
          <div class="invalid-feedback" data-error="cardExpiry"></div>
        </div>
        <div class="col-6">
          <label class="form-label small mb-1" for="cardCvc">CVC</label>
          <input class="form-control" id="cardCvc" name="cardCvc" type="text" inputmode="numeric"
                 autocomplete="cc-csc" placeholder="123" maxlength="3" spellcheck="false">
          <div class="invalid-feedback" data-error="cardCvc"></div>
        </div>
      </div>
      <div class="form-text">Any 16 digits — try ${DEMO_CARD}.</div>
    </div>`;
}

// Retypes `input` through `format` while keeping the caret after the same
// digit, so editing the middle of a grouped number still behaves.
function reformat(input, format) {
  const caret = input.selectionStart ?? input.value.length;
  const digitsBefore = digits(input.value.slice(0, caret)).length;
  input.value = format(input.value);
  let seen = 0;
  let position = input.value.length;
  if (digitsBefore === 0) position = 0;
  else {
    for (let i = 0; i < input.value.length; i += 1) {
      if (/\d/.test(input.value[i])) seen += 1;
      if (seen === digitsBefore) { position = i + 1; break; }
    }
  }
  input.setSelectionRange(position, position);
}

const groupNumber = (value) => digits(value).slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1 ');
const groupExpiry = (value) => {
  const d = digits(value).slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
};

// Live formatting as the member types. Call once, after the fields are in the DOM.
export function wireCard(root = document) {
  const number = $('#cardNumber', root);
  if (!number) return;
  const pairs = [
    [number, groupNumber],
    [$('#cardExpiry', root), groupExpiry],
    [$('#cardCvc', root), (v) => digits(v).slice(0, 3)],
  ];
  for (const [input, format] of pairs) {
    input.addEventListener('input', () => {
      reformat(input, format);
      input.classList.remove('is-invalid');
    });
  }
}

// Empties the fields and clears any errors, so a reopened dialog starts fresh.
export function resetCard(root = document) {
  for (const id of FIELDS) {
    const input = $(`#${id}`, root);
    if (!input) continue;
    input.value = '';
    input.classList.remove('is-invalid');
  }
}

// Format-only checks. Returns { field: message } for whatever is wrong.
function cardErrors(root) {
  const errors = {};
  const number = digits($('#cardNumber', root)?.value);
  if (!number) errors.cardNumber = 'Enter your card number';
  else if (number.length !== 16) errors.cardNumber = `A card number is 16 digits — you entered ${number.length}`;

  const expiry = ($('#cardExpiry', root)?.value || '').trim();
  const parts = expiry.match(/^(\d{2})\/(\d{2})$/);
  const month = parts && Number(parts[1]);
  if (!expiry) errors.cardExpiry = 'Enter the expiry date';
  else if (!parts || month < 1 || month > 12) errors.cardExpiry = 'Use the format MM/YY';
  // Valid through the last day of the printed month.
  else if (new Date(2000 + Number(parts[2]), month, 1) <= new Date()) errors.cardExpiry = 'This card has expired';

  const cvc = digits($('#cardCvc', root)?.value);
  if (!cvc) errors.cardCvc = 'Enter the code';
  else if (cvc.length !== 3) errors.cardCvc = 'The code is 3 digits';

  return errors;
}

// Validates and returns the card to send, or null once the errors are shown.
export function readCard(root = document) {
  const errors = cardErrors(root);
  for (const id of FIELDS) {
    const input = $(`#${id}`, root);
    if (!input) continue;
    input.classList.toggle('is-invalid', Boolean(errors[id]));
    const feedback = $(`[data-error="${id}"]`, root);
    if (feedback) feedback.textContent = errors[id] || '';
  }
  const first = FIELDS.find((id) => errors[id]);
  if (first) {
    $(`#${first}`, root)?.focus();
    return null;
  }
  return {
    number: digits($('#cardNumber', root).value),
    expiry: $('#cardExpiry', root).value.trim(),
    cvc: digits($('#cardCvc', root).value),
  };
}
