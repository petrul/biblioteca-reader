import { coverThumbnailUrl } from '../services/coverThumbnail';
import React, { useState, useEffect } from 'react';
import {
  CreditCard,
  ShieldCheck,
  Lock,
  Sparkles,
  CheckCircle,
  X,
  BookOpen,
  ArrowRight,
  Download,
  Building,
  HelpCircle,
  AlertCircle
} from 'lucide-react';
import { Work, BookPurchaseReceipt, PaymentServiceConfig } from '../types/textbase';
import { readerService } from '../services/readerService';
import { languageName } from '../services/languageNames';

interface PaymentCheckoutModalProps {
  work: Work | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (receipt: BookPurchaseReceipt) => void;
}

export const PaymentCheckoutModal: React.FC<PaymentCheckoutModalProps> = ({
  work,
  isOpen,
  onClose,
  onSuccess
}) => {
  const [paymentConfig, setPaymentConfig] = useState<PaymentServiceConfig | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<'card' | 'apple_google' | 'scholar_pass'>('card');
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<BookPurchaseReceipt | null>(null);

  // Form states
  const [cardNumber, setCardNumber] = useState('4242 •••• •••• 4242');
  const [cardExpiry, setCardExpiry] = useState('12/28');
  const [cardCvc, setCardCvc] = useState('888');
  const [cardName, setCardName] = useState('Petru Scholar');
  const [userEmail, setUserEmail] = useState('petru@scriptorium.ro');
  const [academicAffiliation, setAcademicAffiliation] = useState('Faculty of Classical Philology');

  useEffect(() => {
    if (isOpen && work) {
      setErrorMessage(null);
      setReceipt(null);
      readerService.getPaymentConfig().then(cfg => {
        setPaymentConfig(cfg);
      });
      const currentUser = readerService.getCurrentUser();
      if (currentUser?.email) {
        setUserEmail(currentUser.email);
        setCardName(currentUser.name);
      }
    }
  }, [isOpen, work]);

  if (!isOpen || !work) return null;

  const priceFormatted = `$${(((work.priceCents || 499)) / 100).toFixed(2)}`;

  const handleProcessPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);
    setErrorMessage(null);

    try {
      // 1. Create Payment Intent on backend Express server
      const intentRes = await readerService.createPaymentIntent(work, userEmail);
      
      // Artificial slight smooth delay for realistic checkout feedback
      await new Promise(r => setTimeout(r, 900));

      const paymentId = intentRes.paymentId || `pi_sandbox_${Date.now()}`;

      // 2. Confirm Purchase with backend Express API
      const purchaseReceipt = await readerService.confirmBookPurchase(
        paymentId,
        work,
        userEmail
      );

      setReceipt(purchaseReceipt);
      onSuccess(purchaseReceipt);
    } catch (err: any) {
      console.error('Payment checkout error:', err);
      setErrorMessage(err.message || 'Payment processing failed. Please try again or select another method.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/75 backdrop-blur-md animate-in fade-in duration-200">
      <div 
        className="relative w-full max-w-2xl bg-[#061d28]/95 border border-white/20 rounded-2xl shadow-[0_16px_48px_0_rgba(0,0,0,0.5)] overflow-hidden text-white flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header with Title and Close Button */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/15 bg-white/[0.04]">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-[#f59e0b]">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-wide uppercase text-white">
                {receipt ? 'Purchase Confirmed' : 'Unlock Scholarly Critical Edition'}
              </h2>
              <p className="text-[11px] text-white/60">
                {receipt ? 'Digital License & TEI P5 Source Activated' : 'Secured via Stripe Payment Infrastructure'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-6 space-y-6">
          {receipt ? (
            /* SUCCESS CONFIRMATION STATE */
            <div className="text-center space-y-6 py-4">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 border-2 border-emerald-400/50 flex items-center justify-center mx-auto text-emerald-400">
                <CheckCircle className="w-8 h-8" />
              </div>

              <div>
                <h3 className="text-xl font-bold text-white font-serif">
                  Edition Unlocked: {work.title}
                </h3>
                <p className="text-xs text-white/70 mt-1">
                  By {work.authorName} • {work.chapterCount} Chapters & Complete TEI XML Apparatus
                </p>
              </div>

              {/* Receipt card */}
              <div className="bg-black/40 border border-emerald-500/30 rounded-xl p-4 text-left font-mono text-xs space-y-2.5">
                <div className="flex justify-between border-b border-white/10 pb-2">
                  <span className="text-white/50">Order Number:</span>
                  <span className="text-emerald-300 font-bold">{receipt.orderId}</span>
                </div>
                <div className="flex justify-between border-b border-white/10 pb-2">
                  <span className="text-white/50">Stripe Payment ID:</span>
                  <span className="text-white/80 truncate max-w-[240px]">{receipt.paymentId}</span>
                </div>
                <div className="flex justify-between border-b border-white/10 pb-2">
                  <span className="text-white/50">Amount Paid:</span>
                  <span className="text-amber-300 font-bold">{receipt.amountPaid}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/50">Access Tier:</span>
                  <span className="text-emerald-400 font-bold">{receipt.teiAccessTier}</span>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
                <button
                  id="btn-start-reading-unlocked"
                  onClick={onClose}
                  className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-stone-950 font-bold text-xs flex items-center justify-center space-x-2 cursor-pointer shadow-lg shadow-amber-500/20 transition-all"
                >
                  <BookOpen className="w-4 h-4" />
                  <span>Start Reading Unlocked Work</span>
                </button>
              </div>
            </div>
          ) : (
            /* CHECKOUT FORM STATE */
            <div className="space-y-6">
              {/* Book Summary Banner */}
              <div className="flex gap-4 p-4 rounded-xl bg-white/[0.07] border border-white/15">
                {work.coverImage && (
                  <img
                    src={coverThumbnailUrl(work.coverImage, 160)}
                    alt={work.title}
                    className="w-16 h-22 object-cover rounded-lg border border-white/20 shadow-md shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      Premium Edition
                    </span>
                    <span className="text-[11px] text-white/50 font-mono">
                      {languageName(work.detectedLanguage)} • {work.sizeWords.toLocaleString()} words
                    </span>
                  </div>
                  <h3 className="font-bold text-white text-base font-serif truncate mt-1">
                    {work.title}
                  </h3>
                  <p className="text-xs text-white/70 line-clamp-1 mt-0.5">
                    {work.subtitle || work.summary}
                  </p>
                  <div className="flex items-baseline space-x-2 mt-2">
                    <span className="text-xl font-bold text-amber-400 font-mono">
                      {priceFormatted}
                    </span>
                    <span className="text-[11px] text-white/50">One-time academic license</span>
                  </div>
                </div>
              </div>

              {/* Scholarly Inclusions List */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-white/80 flex items-center space-x-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>What is included in this scholarly critical edition:</span>
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                  {(work.scholarlyPerks || [
                    'Complete Critical Apparatus & Variant Readings',
                    'Full TEI P5 XML Source Download',
                    'Bilingual Interlinear Glosses',
                    'Scholarly Line Commentary & Index'
                  ]).map((perk, i) => (
                    <div key={i} className="flex items-center space-x-2 text-white/80 bg-white/[0.04] p-2 rounded-lg border border-white/10">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span className="truncate">{perk}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Payment Method Tabs */}
              <div className="space-y-3">
                <label className="text-xs font-semibold text-white/80 block">
                  Select Payment Method:
                </label>
                <div className="grid grid-cols-3 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setSelectedMethod('card')}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all cursor-pointer ${
                      selectedMethod === 'card'
                        ? 'bg-white/20 border-amber-400 text-white shadow-md ring-1 ring-amber-400/50'
                        : 'bg-white/[0.05] border-white/15 text-white/70 hover:bg-white/[0.1] hover:text-white'
                    }`}
                  >
                    <CreditCard className="w-4 h-4 mb-1 text-amber-400" />
                    <span className="text-xs font-bold">Credit Card</span>
                    <span className="text-[9px] text-white/50">Visa, MC, Amex</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedMethod('apple_google')}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all cursor-pointer ${
                      selectedMethod === 'apple_google'
                        ? 'bg-white/20 border-amber-400 text-white shadow-md ring-1 ring-amber-400/50'
                        : 'bg-white/[0.05] border-white/15 text-white/70 hover:bg-white/[0.1] hover:text-white'
                    }`}
                  >
                    <Lock className="w-4 h-4 mb-1 text-amber-400" />
                    <span className="text-xs font-bold">Apple / Google Pay</span>
                    <span className="text-[9px] text-white/50">1-Click Fast</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedMethod('scholar_pass')}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all cursor-pointer ${
                      selectedMethod === 'scholar_pass'
                        ? 'bg-white/20 border-amber-400 text-white shadow-md ring-1 ring-amber-400/50'
                        : 'bg-white/[0.05] border-white/15 text-white/70 hover:bg-white/[0.1] hover:text-white'
                    }`}
                  >
                    <Building className="w-4 h-4 mb-1 text-amber-400" />
                    <span className="text-xs font-bold">Scholar Pass</span>
                    <span className="text-[9px] text-white/50">University Grant</span>
                  </button>
                </div>
              </div>

              {/* Form Input fields */}
              <form onSubmit={handleProcessPayment} className="space-y-4">
                {selectedMethod === 'card' && (
                  <div className="space-y-3 bg-black/25 p-4 rounded-xl border border-white/15">
                    <div>
                      <label className="text-[11px] font-medium text-white/70 block mb-1">
                        Cardholder Name
                      </label>
                      <input
                        type="text"
                        value={cardName}
                        onChange={e => setCardName(e.target.value)}
                        required
                        className="w-full px-3 py-2 text-xs rounded-lg bg-black/40 border border-white/20 text-white focus:outline-none focus:ring-1 focus:ring-amber-400"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-medium text-white/70 block mb-1">
                        Card Number
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          value={cardNumber}
                          onChange={e => setCardNumber(e.target.value)}
                          required
                          className="w-full pl-9 pr-3 py-2 text-xs font-mono rounded-lg bg-black/40 border border-white/20 text-white focus:outline-none focus:ring-1 focus:ring-amber-400"
                        />
                        <CreditCard className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/50" />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] font-medium text-white/70 block mb-1">
                          Expires (MM/YY)
                        </label>
                        <input
                          type="text"
                          value={cardExpiry}
                          onChange={e => setCardExpiry(e.target.value)}
                          required
                          className="w-full px-3 py-2 text-xs font-mono rounded-lg bg-black/40 border border-white/20 text-white focus:outline-none focus:ring-1 focus:ring-amber-400"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-medium text-white/70 block mb-1">
                          Security CVC
                        </label>
                        <input
                          type="password"
                          value={cardCvc}
                          onChange={e => setCardCvc(e.target.value)}
                          required
                          maxLength={4}
                          className="w-full px-3 py-2 text-xs font-mono rounded-lg bg-black/40 border border-white/20 text-white focus:outline-none focus:ring-1 focus:ring-amber-400"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {selectedMethod === 'apple_google' && (
                  <div className="p-5 rounded-xl bg-black/25 border border-white/15 text-center space-y-3">
                    <p className="text-xs text-white/80">
                      Biometric one-touch payment via your browser wallet.
                    </p>
                    <div className="inline-flex items-center space-x-2 text-xs font-semibold px-4 py-2 rounded-lg bg-white text-black">
                      <Lock className="w-3.5 h-3.5" />
                      <span>Pay {priceFormatted} with Apple / Google Pay</span>
                    </div>
                  </div>
                )}

                {selectedMethod === 'scholar_pass' && (
                  <div className="p-4 rounded-xl bg-black/25 border border-white/15 space-y-3">
                    <div>
                      <label className="text-[11px] font-medium text-white/70 block mb-1">
                        Academic Department / Institution
                      </label>
                      <input
                        type="text"
                        value={academicAffiliation}
                        onChange={e => setAcademicAffiliation(e.target.value)}
                        required
                        className="w-full px-3 py-2 text-xs rounded-lg bg-black/40 border border-white/20 text-white focus:outline-none focus:ring-1 focus:ring-amber-400"
                      />
                    </div>
                    <p className="text-[11px] text-white/60">
                      Institutional license sponsored via research grant & Scriptorium open scholarship network.
                    </p>
                  </div>
                )}

                {errorMessage && (
                  <div className="p-3 rounded-lg bg-rose-500/20 border border-rose-500/40 text-rose-200 text-xs flex items-center space-x-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                    <span>{errorMessage}</span>
                  </div>
                )}

                {/* Service Mode & Security Info */}
                <div className="flex items-center justify-between text-[11px] text-white/60 pt-1">
                  <div className="flex items-center space-x-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span>256-bit TLS Encrypted Checkout</span>
                  </div>
                  <span className="font-mono text-[10px] text-amber-300/80">
                    {paymentConfig?.isLiveConfigured ? 'Stripe Live Mode' : 'Stripe Test Engine'}
                  </span>
                </div>

                {/* Submit button */}
                <button
                  id="btn-submit-payment"
                  type="submit"
                  disabled={isProcessing}
                  className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-stone-950 font-bold text-sm flex items-center justify-center space-x-2 cursor-pointer transition-all shadow-lg shadow-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isProcessing ? (
                    <span className="flex items-center space-x-2">
                      <span className="w-4 h-4 border-2 border-stone-950 border-t-transparent rounded-full animate-spin"></span>
                      <span>Processing Stripe Payment...</span>
                    </span>
                  ) : (
                    <>
                      <Lock className="w-4 h-4" />
                      <span>Complete Purchase • {priceFormatted}</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
