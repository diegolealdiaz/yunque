import {
  RAIL_NAME,
  isPresent,
  isSupportedCurrency,
  maskAccount,
  normalizeText,
  onFailOf,
  railSupportsCurrency,
} from "@/src/domain";

import { fail, pass, skipped, type Rule } from "./types";
import { accountDigits, evidenceOf, fieldsOf } from "./shared";

/**
 * Reglas sobre el beneficiario y su cuenta. Son el frente contra el fraude por cambio de
 * cuenta: la orden de pago usa siempre la cuenta registrada, y cualquier diferencia frena.
 */

export const payeeNotAllowed: Rule = {
  code: "payee_not_allowed",
  evaluate: (ctx) => {
    const fields = fieldsOf(ctx);
    if (!fields) return skipped("sin lectura");
    const action = onFailOf(ctx.policy, "payee_not_allowed");
    const evidence = evidenceOf(ctx, "payee_name");
    if (ctx.payee.kind === "unknown") {
      const closest = ctx.payee.closest;
      return fail({
        code: "payee_not_allowed",
        action,
        observed: fields.payee_name.value,
        threshold: "lista de beneficiarios permitidos",
        field: "payee_name",
        evidence,
        message: closest
          ? `El beneficiario no está en la lista; se parece a ${closest.vendor.name} pero no coincide`
          : "El beneficiario no está en la lista de permitidos",
      });
    }
    if (!ctx.policy.allowed_payees.includes(ctx.payee.vendor.id)) {
      return fail({
        code: "payee_not_allowed",
        action,
        observed: ctx.payee.vendor.name,
        threshold: "beneficiarios habilitados en la política vigente",
        field: "payee_name",
        evidence,
        message: `${ctx.payee.vendor.name} existe pero no está habilitado en la política vigente`,
      });
    }
    return pass;
  },
};

export const vendorNotVerified: Rule = {
  code: "vendor_not_verified",
  evaluate: (ctx) => {
    if (ctx.payee.kind !== "matched") return skipped("beneficiario sin resolver");
    const { vendor } = ctx.payee;
    if (vendor.verification.status === "verificado") return pass;
    return fail({
      code: "vendor_not_verified",
      action: "escalar",
      observed: "pendiente de verificación",
      threshold: "verificado",
      field: "payee_name",
      message: `${vendor.name} todavía no fue verificado por una persona`,
    });
  },
};

export const bankAccountMismatch: Rule = {
  code: "bank_account_mismatch",
  evaluate: (ctx) => {
    const fields = fieldsOf(ctx);
    if (!fields) return skipped("sin lectura");
    if (ctx.payee.kind !== "matched") return skipped("beneficiario sin resolver");
    if (!isPresent(fields.bank_account)) {
      return skipped("el documento no trae cuenta; se paga a la registrada");
    }
    const registered = ctx.payee.vendor.account.account_number;
    const read = fields.bank_account.value;
    if (accountDigits(read) === accountDigits(registered)) return pass;
    return fail({
      code: "bank_account_mismatch",
      action: "frenar",
      observed: maskAccount(accountDigits(read)),
      threshold: maskAccount(registered),
      field: "bank_account",
      evidence: fields.bank_account.evidence,
      message: "La cuenta del documento no coincide con la registrada del beneficiario",
    });
  },
};

export const accountHolderMismatch: Rule = {
  code: "account_holder_mismatch",
  evaluate: (ctx) => {
    const fields = fieldsOf(ctx);
    if (!fields) return skipped("sin lectura");
    if (ctx.payee.kind !== "matched") return skipped("beneficiario sin resolver");
    if (!isPresent(fields.bank_account)) return skipped("el documento no trae cuenta");
    const { vendor } = ctx.payee;
    if (!isPresent(fields.bank_holder)) {
      return fail({
        code: "account_holder_mismatch",
        action: "frenar",
        observed: "sin titular",
        threshold: vendor.account.holder_name,
        field: "bank_holder",
        evidence: fields.bank_account.evidence,
        message: "El documento trae una cuenta pero no dice de quién es",
      });
    }
    const read = normalizeText(fields.bank_holder.value);
    const accepted = [vendor.account.holder_name, vendor.name, ...vendor.aliases].map(
      normalizeText,
    );
    if (accepted.includes(read)) return pass;
    return fail({
      code: "account_holder_mismatch",
      action: "frenar",
      observed: fields.bank_holder.value,
      threshold: vendor.account.holder_name,
      field: "bank_holder",
      evidence: fields.bank_holder.evidence,
      message: "El titular de la cuenta no coincide con el beneficiario registrado",
    });
  },
};

export const unsupportedCurrencyOrRail: Rule = {
  code: "unsupported_currency_or_rail",
  evaluate: (ctx) => {
    const fields = fieldsOf(ctx);
    if (!fields) return skipped("sin lectura");
    const code = fields.currency.value;
    const evidence = fields.currency.evidence;
    if (!isSupportedCurrency(code)) {
      return fail({
        code: "unsupported_currency_or_rail",
        action: "frenar",
        observed: code,
        threshold: "USD, EUR, COP, BRL, MXN, ARS",
        field: "currency",
        evidence,
        message: `La moneda ${code} no tiene ruta de pago disponible`,
      });
    }
    if (ctx.payee.kind !== "matched") return pass;
    const { account } = ctx.payee.vendor;
    if (account.currency === code && railSupportsCurrency(account.rail, code)) return pass;
    return fail({
      code: "unsupported_currency_or_rail",
      action: "frenar",
      observed: `${code} por ${RAIL_NAME[account.rail]}`,
      threshold: `${account.currency} por ${RAIL_NAME[account.rail]}`,
      field: "currency",
      evidence,
      message: `La cuenta registrada de ${ctx.payee.vendor.name} no recibe ${code} por ${account.rail}`,
    });
  },
};

export const PAYEE_RULES: readonly Rule[] = [
  unsupportedCurrencyOrRail,
  payeeNotAllowed,
  vendorNotVerified,
  bankAccountMismatch,
  accountHolderMismatch,
];
