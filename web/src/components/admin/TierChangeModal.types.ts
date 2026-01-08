import { z } from "zod";

export const tierChangeFormSchema = z.object({
  tier: z.enum(["free", "pro", "team", "enterprise"]),
  billingInterval: z.enum(["monthly", "annual"]),
  customPriceMonthly: z.number().positive().optional(),
  customPriceAnnual: z.number().positive().optional(),
  paymentMethod: z.enum(["immediate", "invoice", "trial"]),
  trialDays: z.number().int().min(0).max(730).optional(),
  subscriptionStartDate: z.string().optional(),
  reason: z.string().min(1).max(500),
  // For downgrades: "scheduled" (at period end) or "immediate" (now with prorated credit/refund)
  downgradeTiming: z.enum(["scheduled", "immediate"]).optional(),
  // For immediate downgrades: "refund" (money back) or "credit" (Stripe account credit)
  refundType: z.enum(["refund", "credit"]).optional(),
})
.refine(
  (data) => {
    // Custom pricing required for Enterprise tier
    if (data.tier === "enterprise") {
      return data.billingInterval === "monthly"
        ? !!data.customPriceMonthly
        : !!data.customPriceAnnual;
    }
    return true;
  },
  { message: "Custom pricing required for Enterprise", path: ["customPriceMonthly"] }
)
.refine(
  (data) => {
    // Trial days required when payment method is trial (but not for free tier or downgrades)
    // For downgrades, paymentMethod is irrelevant - refundType is used instead
    if (data.tier === "free") return true;
    if (data.downgradeTiming) return true; // Skip for downgrades
    return data.paymentMethod !== "trial" || (data.trialDays && data.trialDays > 0);
  },
  { message: "Trial days required when payment method is trial", path: ["trialDays"] }
);

export type TierChangeFormData = z.infer<typeof tierChangeFormSchema>;
