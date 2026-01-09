"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, CheckCircle2, ArrowLeft, Building2, Users, Zap, Shield } from "lucide-react";
import { apiClient } from "@/lib/api/client";

const COMPANY_SIZES = [
  { value: "1-10", label: "1-10 employees" },
  { value: "11-50", label: "11-50 employees" },
  { value: "51-200", label: "51-200 employees" },
  { value: "201-500", label: "201-500 employees" },
  { value: "500+", label: "500+ employees" },
] as const;

const enterpriseInquirySchema = z.object({
  company_name: z
    .string()
    .min(2, "Company name must be at least 2 characters")
    .max(200, "Company name must be less than 200 characters"),
  work_email: z
    .string()
    .email("Please enter a valid work email address"),
  company_size: z
    .string()
    .min(1, "Please select your company size"),
  use_case: z
    .string()
    .min(20, "Please provide more details about your use case (at least 20 characters)")
    .max(5000, "Use case description is too long"),
});

type EnterpriseInquiryFormData = z.infer<typeof enterpriseInquirySchema>;

export default function ContactSalesPage() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [ticketNumber, setTicketNumber] = useState<string | null>(null);
  const router = useRouter();

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<EnterpriseInquiryFormData>({
    resolver: zodResolver(enterpriseInquirySchema),
    defaultValues: {
      company_name: "",
      work_email: "",
      company_size: "",
      use_case: "",
    },
  });

  const companySizeValue = watch("company_size");

  const onSubmit = async (data: EnterpriseInquiryFormData) => {
    setIsSubmitting(true);

    try {
      const response = await apiClient.submitEnterpriseInquiry(data);

      if (response.error) {
        toast.error(response.error.message || "Failed to submit inquiry");
        return;
      }

      if (response.data?.success) {
        setTicketNumber(response.data.ticket_number);
        setIsSuccess(true);
        toast.success("Your inquiry has been submitted!");
      }
    } catch {
      toast.error("An unexpected error occurred. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Success state
  if (isSuccess) {
    return (
      <Card className="border-0 shadow-lg">
        <CardContent className="pt-12 pb-8 text-center">
          <div className="mx-auto w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-6">
            <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Thanks for reaching out!</h2>
          <p className="text-muted-foreground mb-4">
            Your inquiry has been received. Our enterprise team will contact you within 1 business day.
          </p>
          {ticketNumber && (
            <p className="text-sm text-muted-foreground mb-6">
              Reference: <span className="font-mono font-medium">{ticketNumber}</span>
            </p>
          )}
          <Button onClick={() => router.push("/")} className="mt-4">
            Return to Dashboard
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {/* Back link */}
      <Link
        href="/"
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Dashboard
      </Link>

      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-3">
          Talk to our Enterprise team
        </h1>
        <p className="text-muted-foreground max-w-md mx-auto">
          Get custom pricing, dedicated support, and enterprise-grade features for your organization.
        </p>
      </div>

      {/* Enterprise Benefits */}
      <div className="grid grid-cols-2 gap-3 mb-8">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Building2 className="h-4 w-4 text-primary" />
          <span>Custom pricing</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Users className="h-4 w-4 text-primary" />
          <span>Unlimited team members</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Zap className="h-4 w-4 text-primary" />
          <span>Priority support</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Shield className="h-4 w-4 text-primary" />
          <span>SLA guarantees</span>
        </div>
      </div>

      {/* Form */}
      <Card className="border-0 shadow-lg">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Contact Information</CardTitle>
          <CardDescription>
            Fill out the form below and we&apos;ll get back to you shortly.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            {/* Company Name */}
            <div className="space-y-2">
              <Label htmlFor="company_name">
                Company name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="company_name"
                placeholder="Acme Inc."
                {...register("company_name")}
                className={errors.company_name ? "border-destructive" : ""}
              />
              {errors.company_name && (
                <p className="text-sm text-destructive">{errors.company_name.message}</p>
              )}
            </div>

            {/* Work Email */}
            <div className="space-y-2">
              <Label htmlFor="work_email">
                Work email <span className="text-destructive">*</span>
              </Label>
              <Input
                id="work_email"
                type="email"
                placeholder="you@company.com"
                {...register("work_email")}
                className={errors.work_email ? "border-destructive" : ""}
              />
              {errors.work_email && (
                <p className="text-sm text-destructive">{errors.work_email.message}</p>
              )}
            </div>

            {/* Company Size */}
            <div className="space-y-2">
              <Label htmlFor="company_size">
                Company size <span className="text-destructive">*</span>
              </Label>
              <Select
                value={companySizeValue}
                onValueChange={(value) => setValue("company_size", value, { shouldValidate: true })}
              >
                <SelectTrigger
                  id="company_size"
                  className={errors.company_size ? "border-destructive" : ""}
                >
                  <SelectValue placeholder="Select company size" />
                </SelectTrigger>
                <SelectContent>
                  {COMPANY_SIZES.map((size) => (
                    <SelectItem key={size.value} value={size.value}>
                      {size.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.company_size && (
                <p className="text-sm text-destructive">{errors.company_size.message}</p>
              )}
            </div>

            {/* Use Case */}
            <div className="space-y-2">
              <Label htmlFor="use_case">
                Tell us about your use case <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="use_case"
                placeholder="Describe how you plan to use PlexMCP and any specific requirements you have..."
                rows={4}
                {...register("use_case")}
                className={errors.use_case ? "border-destructive" : ""}
              />
              {errors.use_case && (
                <p className="text-sm text-destructive">{errors.use_case.message}</p>
              )}
            </div>

            {/* Submit Button */}
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                "Submit Inquiry"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Privacy Note */}
      <p className="text-xs text-muted-foreground text-center mt-6">
        By submitting, you agree to our{" "}
        <Link href="/terms" className="underline hover:text-primary">
          Terms of Service
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="underline hover:text-primary">
          Privacy Policy
        </Link>.
      </p>
    </>
  );
}
