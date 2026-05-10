import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useLocalization } from '../contexts/LocalizationContext';
import { useAuth } from '../contexts/AuthContextSupabase';
import { Invoice, Expense, Receipt, RecurringInvoice, RecurringExpense, RecurrenceFrequency, Budget, Project, BudgetLine, BudgetItem, RESOURCE_MANAGEMENT_ROLES, Language, CurrencyCode } from '../types';
import ConfirmationModal from './common/ConfirmationModal';
import { CurrencyService } from '../services/currencyService';
import { FinanceAnalytics } from './FinanceAnalytics';

const DEFAULT_USD_RATES: Record<CurrencyCode, number> = {
    USD: 1,
    EUR: 0.92,
    XOF: 604
};

const currencyOptions: { code: CurrencyCode; label: string }[] = [
    { code: 'USD', label: 'USD ($)' },
    { code: 'EUR', label: 'EUR (€)' },
    { code: 'XOF', label: 'CFA (XOF)' }
];

type FormatCurrencyOptions = {
    currencyCode?: CurrencyCode;
    baseAmountUSD?: number;
    exchangeRate?: number;
};

type CurrencyInfo = FormatCurrencyOptions & {
    amount?: number;
};

const getInvoiceCurrencyInfo = (invoice: Invoice): CurrencyInfo => ({
    amount: invoice.amount,
    currencyCode: invoice.currencyCode,
    baseAmountUSD: invoice.baseAmountUSD,
    exchangeRate: invoice.exchangeRate
});

const getExpenseCurrencyInfo = (expense: Expense): CurrencyInfo => ({
    amount: expense.amount,
    currencyCode: expense.currencyCode,
    baseAmountUSD: expense.baseAmountUSD,
    exchangeRate: expense.exchangeRate
});

const getRecurringInvoiceCurrencyInfo = (recurringInvoice: RecurringInvoice): CurrencyInfo => ({
    amount: recurringInvoice.amount,
    currencyCode: recurringInvoice.currencyCode,
    baseAmountUSD: recurringInvoice.baseAmountUSD,
    exchangeRate: recurringInvoice.exchangeRate
});

const getRecurringExpenseCurrencyInfo = (recurringExpense: RecurringExpense): CurrencyInfo => ({
    amount: recurringExpense.amount,
    currencyCode: recurringExpense.currencyCode,
    baseAmountUSD: recurringExpense.baseAmountUSD,
    exchangeRate: recurringExpense.exchangeRate
});

const getBudgetCurrencyInfo = (budget: Budget): CurrencyInfo => ({
    amount: budget.amount,
    currencyCode: budget.currencyCode,
    baseAmountUSD: budget.baseAmountUSD,
    exchangeRate: budget.exchangeRate
});

const statusStyles: { [key in Invoice['status']]: string } = {
    'Draft': 'bg-gray-200 text-gray-800',
    'Sent': 'bg-blue-200 text-blue-800',
    'Paid': 'bg-emerald-200 text-emerald-800',
    'Overdue': 'bg-red-200 text-red-800',
    'Partially Paid': 'bg-yellow-200 text-yellow-800',
};

const StatCard: React.FC<{ title: string; value: string; icon: string; color: string }> = ({ title, value, icon, color }) => (
  <div className="bg-white p-6 rounded-xl shadow-lg flex items-center space-x-4">
    <div className={`text-3xl ${color}`}><i className={icon}></i></div>
    <div>
      <p className="text-gray-500 text-sm font-medium">{title}</p>
      <p className="text-2xl font-bold text-gray-800">{value}</p>
    </div>
  </div>
);

const ReceiptViewerModal: React.FC<{ receipt: Receipt; onClose: () => void; }> = ({ receipt, onClose }) => {
    const isImage = receipt.dataUrl.startsWith('data:image/');
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-[70] p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
                <div className="p-4 border-b flex justify-between items-center">
                    <h2 className="text-lg font-bold truncate">{receipt.fileName}</h2>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-800"><i className="fas fa-times"></i></button>
                </div>
                <div className="p-6 flex-grow overflow-auto flex justify-center items-center">
                    {isImage ? (
                        <img src={receipt.dataUrl} alt={receipt.fileName} className="max-w-full max-h-full object-contain" />
                    ) : (
                        <div className="text-center">
                            <i className="fas fa-file-alt text-5xl text-gray-400 mb-4"></i>
                            <p>Preview is not available for this file type.</p>
                            <a href={receipt.dataUrl} download={receipt.fileName} className="mt-4 inline-block bg-emerald-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-emerald-700">
                                Download {receipt.fileName}
                            </a>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const ExchangeGainLossIndicator: React.FC<{
    amount: number;
    currency?: CurrencyCode;
    exchangeRate?: number;
    transactionDate?: string;
    size?: 'sm' | 'md';
}> = ({ amount, currency = 'USD' as CurrencyCode, exchangeRate, transactionDate, size = 'sm' }) => {
    const { t } = useLocalization();
    const [gainLoss, setGainLoss] = useState<{ gainLoss: number; gainLossPercent: number } | null>(null);

    useEffect(() => {
        let mounted = true;
        if (!currency || currency === 'USD' || amount === 0) {
            setGainLoss(null);
            return;
        }

        // Utiliser le taux de change historique si disponible
        const calculateGainLoss = async () => {
            try {
                // Si on a un taux de change et une date, calculer avec le taux historique
                if (exchangeRate && transactionDate) {
                    const currentRate = await CurrencyService.getRateToUSD(currency as CurrencyCode);
                    const originalUSD = amount * exchangeRate;
                    const currentUSD = amount * currentRate;
                    const gainLossValue = currentUSD - originalUSD;
                    const gainLossPercent = originalUSD === 0 ? 0 : (gainLossValue / originalUSD) * 100;
                    
                    if (mounted) {
                        setGainLoss({
                            gainLoss: gainLossValue,
                            gainLossPercent
                        });
                    }
                } else {
                    // Sinon, utiliser la méthode standard
                    const result = await CurrencyService.calculateExchangeGainLoss(amount, currency || 'USD' as CurrencyCode, exchangeRate);
                    if (mounted) {
                        setGainLoss({
                            gainLoss: result.gainLoss,
                            gainLossPercent: result.gainLossPercent
                        });
                    }
                }
            } catch (error) {
                console.error('Erreur calcul gain/perte de change:', error);
            }
        };

        calculateGainLoss();

        return () => {
            mounted = false;
        };
    }, [amount, currency, exchangeRate, transactionDate]);

    if (!gainLoss || Math.abs(gainLoss.gainLoss) < 0.01) {
        return null;
    }

    const isGain = gainLoss.gainLoss > 0;
    const sizeClass = size === 'md' ? 'text-sm' : 'text-xs';

    return (
        <div className={`${sizeClass} ${isGain ? 'text-green-600' : 'text-red-600'} flex items-center gap-1`}>
            <span>{isGain ? '↑' : '↓'}</span>
            <span>{Math.abs(gainLoss.gainLossPercent).toFixed(2)}%</span>
            <span className="text-gray-500 text-xs">
                ({isGain ? '+' : ''}{gainLoss.gainLoss.toFixed(2)} USD)
            </span>
        </div>
    );
};


const InvoiceFormModal: React.FC<{
    invoice: Invoice | null;
    onClose: () => void;
    onSave: (invoice: Invoice | Omit<Invoice, 'id'>) => void;
    onSaveRecurring: (data: Omit<RecurringInvoice, 'id'>) => void;
}> = ({ invoice, onClose, onSave, onSaveRecurring }) => {
    const { t, language } = useLocalization();
    const isEditMode = invoice !== null;
    const [isRecurring, setIsRecurring] = useState(false);
    
    const [formData, setFormData] = useState({
        invoiceNumber: invoice?.invoiceNumber || `INV-${Date.now().toString().slice(-4)}`,
        clientName: invoice?.clientName || '',
        amount: invoice?.amount ? String(invoice.amount) : '',
        currencyCode: invoice?.currencyCode || 'USD',
        transactionDate: invoice?.transactionDate || new Date().toISOString().split('T')[0],
        dueDate: invoice?.dueDate || '',
        status: invoice?.status || 'Draft',
        paidAmount: invoice?.paidAmount ? String(invoice.paidAmount) : '',
        useManualRate: false,
        manualExchangeRate: invoice?.exchangeRate ? String(invoice.exchangeRate) : '',
    });

    const [recurringData, setRecurringData] = useState({
        frequency: 'Monthly' as RecurrenceFrequency,
        startDate: new Date().toISOString().split('T')[0],
        endDate: '',
    });

    const [receipt, setReceipt] = useState<Receipt | null>(invoice?.receipt || null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (loadEvent) => {
                setReceipt({
                    fileName: file.name,
                    dataUrl: loadEvent.target?.result as string,
                });
            };
            reader.readAsDataURL(file);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({...prev, [name]: value }));
    };

    const handleRecurringChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setRecurringData(prev => ({...prev, [name]: value }));
    };

    const formLocale = language === Language.FR ? 'fr-FR' : 'en-US';

    const formatFormCurrency = useCallback((value: number) => {
        try {
            return new Intl.NumberFormat(formLocale, {
                style: 'currency',
                currency: formData.currencyCode as CurrencyCode
            }).format(value);
        } catch (error) {
            return `${formData.currencyCode} ${value.toFixed(2)}`;
        }
    }, [formData.currencyCode, formLocale]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        
        // Validation pour paiement partiel
        if (formData.status === 'Partially Paid') {
            const paidAmount = Number(formData.paidAmount);
            const totalAmount = Number(formData.amount);
            
            if (!formData.paidAmount || isNaN(paidAmount) || paidAmount <= 0) {
                alert(t('finance_partial_payment_amount_required'));
                return;
            }
            
            if (paidAmount >= totalAmount) {
                alert(t('finance_partial_payment_must_be_less_total'));
                return;
            }
            
            if (paidAmount > totalAmount) {
                alert(t('finance_partial_payment_cannot_exceed_total'));
                return;
            }
        }
        
        if (isRecurring) {
            const recurringToSave: any = {
                clientName: formData.clientName,
                amount: Number(formData.amount),
                currencyCode: formData.currencyCode as CurrencyCode,
                frequency: recurringData.frequency,
                startDate: recurringData.startDate,
                endDate: recurringData.endDate || undefined,
                lastGeneratedDate: new Date(recurringData.startDate).toISOString().split('T')[0],
            };
            
            // Ajouter le taux manuel si fourni
            if (formData.useManualRate && formData.manualExchangeRate) {
                recurringToSave.manualExchangeRate = Number(formData.manualExchangeRate);
            }
            
            onSaveRecurring(recurringToSave);
        } else {
            const isNowPaid = formData.status === 'Paid' && (!invoice || invoice.status !== 'Paid');
            
            // Calculer paidAmount correctement
            let finalPaidAmount: number | undefined = undefined;
            if (formData.status === 'Partially Paid' && formData.paidAmount) {
                finalPaidAmount = Number(formData.paidAmount);
            } else if (formData.status === 'Paid') {
                finalPaidAmount = Number(formData.amount);
            }
            
            const dataToSave: any = {
                ...formData,
                amount: Number(formData.amount),
                currencyCode: formData.currencyCode as CurrencyCode,
                transactionDate: formData.transactionDate,
                paidAmount: finalPaidAmount,
                receipt: receipt || undefined,
                paidDate: isNowPaid ? new Date().toISOString().split('T')[0] : (invoice?.paidDate || undefined),
            };
            
            // Ajouter le taux manuel si fourni
            if (formData.useManualRate && formData.manualExchangeRate) {
                dataToSave.manualExchangeRate = Number(formData.manualExchangeRate);
            }
            
            // Retirer les champs de formulaire non nécessaires
            delete dataToSave.useManualRate;
            
            onSave(isEditMode ? { ...invoice, ...dataToSave } as Invoice : dataToSave as Omit<Invoice, 'id'>);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-[60] p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-lg">
                <form onSubmit={handleSubmit}>
                    <div className="p-6 border-b"><h2 className="text-xl font-bold">{isEditMode ? t('edit_invoice') : t('create_invoice')}</h2></div>
                    <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700">{t('client_name')}</label>
                                <input name="clientName" value={formData.clientName} onChange={handleChange} className="mt-1 block w-full p-2 border rounded-md" required/>
                            </div>
                             <div>
                                <label className="block text-sm font-medium text-gray-700">{t('amount')}</label>
                                <input type="number" name="amount" value={formData.amount} onChange={handleChange} className="mt-1 block w-full p-2 border rounded-md" required/>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700">{t('finance_currency_field_label')}</label>
                                <select
                                    name="currencyCode"
                                    value={formData.currencyCode}
                                    onChange={handleChange}
                                    className="mt-1 block w-full p-2 border rounded-md"
                                >
                                    {currencyOptions.map(option => (
                                        <option key={option.code} value={option.code}>{option.label}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">{t('finance_transaction_date')}</label>
                                <input
                                    type="date"
                                    name="transactionDate"
                                    value={formData.transactionDate}
                                    onChange={handleChange}
                                    className="mt-1 block w-full p-2 border rounded-md"
                                    required
                                />
                            </div>
                        </div>
                        
                        {/* Option de saisie manuelle du taux de change */}
                        {formData.currencyCode !== 'USD' && (
                            <div className="border-t pt-4 mt-4">
                                <div className="flex items-center mb-3">
                                    <input
                                        type="checkbox"
                                        id="useManualRate"
                                        checked={formData.useManualRate}
                                        onChange={(e) => setFormData(prev => ({ ...prev, useManualRate: e.target.checked }))}
                                        className="mr-2"
                                    />
                                    <label htmlFor="useManualRate" className="text-sm font-medium text-gray-700">
                                        {t('finance_use_manual_rate') || 'Utiliser un taux de change manuel'}
                                    </label>
                                </div>
                                {formData.useManualRate && (
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            {t('finance_manual_exchange_rate') || 'Taux de change vers USD'} (1 {formData.currencyCode} = ? USD)
                                        </label>
                                        <input
                                            type="number"
                                            name="manualExchangeRate"
                                            value={formData.manualExchangeRate}
                                            onChange={handleChange}
                                            className="mt-1 block w-full p-2 border rounded-md"
                                            placeholder="Ex: 1.08"
                                            step="0.0001"
                                            min="0.0001"
                                            required={formData.useManualRate}
                                        />
                                        <p className="text-xs text-gray-500 mt-1">
                                            {t('finance_manual_rate_help') || 'Laissez vide pour utiliser le taux automatique de l\'API'}
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}

                        {!isRecurring && (
                            <>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                     <div>
                                        <label className="block text-sm font-medium text-gray-700">{t('invoice_number')}</label>
                                        <input name="invoiceNumber" value={formData.invoiceNumber} onChange={handleChange} className="mt-1 block w-full p-2 border rounded-md bg-gray-100" readOnly/>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700">{t('due_date')}</label>
                                        <input type="date" name="dueDate" value={formData.dueDate} onChange={handleChange} className="mt-1 block w-full p-2 border rounded-md" required/>
                                    </div>
                                </div>
                                 <div>
                                    <label className="block text-sm font-medium text-gray-700">{t('status')}</label>
                                    <select name="status" value={formData.status} onChange={handleChange} className="mt-1 block w-full p-2 border rounded-md">
                                        <option value="Draft">{t('draft')}</option>
                                        <option value="Sent">{t('sent')}</option>
                                        <option value="Partially Paid">{t('partially_paid')}</option>
                                        <option value="Paid">{t('paid')}</option>
                                        <option value="Overdue">{t('overdue')}</option>
                                    </select>
                                </div>
                                {formData.status === 'Partially Paid' && (
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700">{t('paid_amount')}</label>
                                        <input 
                                            type="number" 
                                            name="paidAmount" 
                                            value={formData.paidAmount} 
                                            onChange={handleChange} 
                                            className="mt-1 block w-full p-2 border rounded-md" 
                                            placeholder={t('finance_paid_amount_placeholder')}
                                            min="0.01"
                                            max={formData.amount || undefined}
                                            step="0.01"
                                            required
                                        />
                                        {formData.amount && (
                                            <p className="mt-1 text-xs text-gray-500">
                                                {t('finance_total_amount_label')}: {formatFormCurrency(Number(formData.amount) || 0)} | 
                                                {t('finance_amount_remaining_label')}: {formatFormCurrency((Number(formData.amount) || 0) - (Number(formData.paidAmount) || 0))}
                                            </p>
                                        )}
                                    </div>
                                )}
                                 <div>
                                    <label className="block text-sm font-medium text-gray-700">{t('receipt')}</label>
                                    {receipt ? (
                                        <div className="mt-1 flex items-center justify-between p-2 border rounded-md bg-gray-50">
                                            <span className="text-sm truncate">{receipt.fileName}</span>
                                            <button type="button" onClick={() => setReceipt(null)} className="ml-2 text-red-500 hover:text-red-700 text-xs font-bold">{t('remove_receipt')}</button>
                                        </div>
                                    ) : (
                                        <input type="file" onChange={handleFileChange} className="mt-1 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100"/>
                                    )}
                                </div>
                            </>
                        )}
                        
                        {!isEditMode && (
                             <div className="pt-4 border-t">
                                <label className="flex items-center space-x-3 cursor-pointer">
                                    <input type="checkbox" checked={isRecurring} onChange={e => setIsRecurring(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"/>
                                    <span className="text-sm font-medium text-gray-700">{t('make_recurring')}</span>
                                </label>
                            </div>
                        )}
                       
                        {isRecurring && (
                            <div className="space-y-4 pt-4 border-t border-dashed">
                                 <div>
                                    <label className="block text-sm font-medium text-gray-700">{t('frequency')}</label>
                                    <select name="frequency" value={recurringData.frequency} onChange={handleRecurringChange} className="mt-1 block w-full p-2 border rounded-md">
                                        <option value="Monthly">{t('monthly')}</option>
                                        <option value="Quarterly">{t('quarterly')}</option>
                                        <option value="Annually">{t('annually')}</option>
                                    </select>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700">{t('start_date')}</label>
                                        <input type="date" name="startDate" value={recurringData.startDate} onChange={handleRecurringChange} className="mt-1 block w-full p-2 border rounded-md" required/>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700">{t('end_date_optional')}</label>
                                        <input type="date" name="endDate" value={recurringData.endDate} onChange={handleRecurringChange} className="mt-1 block w-full p-2 border rounded-md"/>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="p-4 bg-gray-50 border-t flex justify-end space-x-2">
                        <button type="button" onClick={onClose} className="bg-gray-200 text-gray-800 px-4 py-2 rounded-lg font-semibold hover:bg-gray-300">{t('cancel')}</button>
                        <button type="submit" className="bg-emerald-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-emerald-700">{t('save')}</button>
                    </div>
                </form>
            </div>
        </div>
    );
}

const ExpenseFormModal: React.FC<{
    expense: Expense | null;
    budgets: Budget[];
    expenses: Expense[];
    onClose: () => void;
    onSave: (expense: Expense | Omit<Expense, 'id'>) => void;
    onSaveRecurring: (data: Omit<RecurringExpense, 'id'>) => void;
}> = ({ expense, budgets, expenses, onClose, onSave, onSaveRecurring }) => {
    const { t, language } = useLocalization();
    const isEditMode = expense !== null;
    const [isRecurring, setIsRecurring] = useState(false);
    const locale = language === Language.FR ? 'fr-FR' : 'en-US';
    
    const formatBudgetCurrency = useCallback((value: number, currencyCode: CurrencyCode = 'USD') => {
        return CurrencyService.formatCurrency(value, currencyCode, locale);
    }, [locale]);

    const [formData, setFormData] = useState({
        category: expense?.category || 'Software',
        description: expense?.description || '',
        amount: expense?.amount ? String(expense.amount) : '',
        currencyCode: expense?.currencyCode || 'USD',
        date: expense?.date || new Date().toISOString().split('T')[0],
        transactionDate: expense?.transactionDate || expense?.date || new Date().toISOString().split('T')[0],
        dueDate: expense?.dueDate || '',
        status: expense?.status || 'Unpaid',
        budgetItemId: expense?.budgetItemId || '',
        useManualRate: false,
        manualExchangeRate: expense?.exchangeRate ? String(expense.exchangeRate) : '',
    });
    
     const [recurringData, setRecurringData] = useState({
        frequency: 'Monthly' as RecurrenceFrequency,
        startDate: new Date().toISOString().split('T')[0],
        endDate: '',
    });

    const [receipt, setReceipt] = useState<Receipt | null>(expense?.receipt || null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (loadEvent) => {
                setReceipt({
                    fileName: file.name,
                    dataUrl: loadEvent.target?.result as string,
                });
            };
            reader.readAsDataURL(file);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        setFormData(prev => ({...prev, [e.target.name]: e.target.value }));
    };

     const handleRecurringChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setRecurringData(prev => ({...prev, [name]: value }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
         if (isRecurring) {
            const recurringToSave: any = {
                category: formData.category,
                description: formData.description,
                amount: Number(formData.amount),
                currencyCode: formData.currencyCode as CurrencyCode,
                frequency: recurringData.frequency,
                startDate: recurringData.startDate,
                endDate: recurringData.endDate || undefined,
                lastGeneratedDate: new Date(recurringData.startDate).toISOString().split('T')[0],
            };
            
            // Ajouter le taux manuel si fourni
            if (formData.useManualRate && formData.manualExchangeRate) {
                recurringToSave.manualExchangeRate = Number(formData.manualExchangeRate);
            }
            
            onSaveRecurring(recurringToSave);
        } else {
            const dataToSave: any = {
                ...formData,
                amount: Number(formData.amount),
                currencyCode: formData.currencyCode as CurrencyCode,
                transactionDate: formData.transactionDate || formData.date,
                status: formData.status as 'Unpaid' | 'Paid',
                dueDate: formData.dueDate || undefined,
                budgetItemId: formData.budgetItemId || undefined,
                receipt: receipt || undefined,
            };
            
            // Ajouter le taux manuel si fourni
            if (formData.useManualRate && formData.manualExchangeRate) {
                dataToSave.manualExchangeRate = Number(formData.manualExchangeRate);
            }
            
            // Retirer les champs de formulaire non nécessaires
            delete dataToSave.useManualRate;
            
            onSave(isEditMode ? { ...expense, ...dataToSave } : dataToSave);
        }
    };

    return (
         <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-[60] p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-lg">
                <form onSubmit={handleSubmit}>
                    <div className="p-6 border-b"><h2 className="text-xl font-bold">{isEditMode ? t('edit_expense') : t('create_expense')}</h2></div>
                    <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                        <div>
                             <label className="block text-sm font-medium text-gray-700">{t('description')}</label>
                             <textarea name="description" value={formData.description} onChange={handleChange} rows={2} className="mt-1 block w-full p-2 border rounded-md" required/>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700">{t('category')}</label>
                                <select name="category" value={formData.category} onChange={handleChange} className="mt-1 block w-full p-2 border rounded-md">
                                    <option>Software</option>
                                    <option>Office Supplies</option>
                                    <option>Marketing</option>
                                    <option>Utilities</option>
                                    <option>Travel</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">{t('amount')}</label>
                                <input type="number" name="amount" value={formData.amount} onChange={handleChange} className="mt-1 block w-full p-2 border rounded-md" required/>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700">{t('finance_currency_field_label')}</label>
                                <select
                                    name="currencyCode"
                                    value={formData.currencyCode}
                                    onChange={handleChange}
                                    className="mt-1 block w-full p-2 border rounded-md"
                                >
                                    {currencyOptions.map(option => (
                                        <option key={option.code} value={option.code}>{option.label}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">{t('finance_transaction_date')}</label>
                                <input
                                    type="date"
                                    name="transactionDate"
                                    value={formData.transactionDate}
                                    onChange={handleChange}
                                    className="mt-1 block w-full p-2 border rounded-md"
                                    required
                                />
                            </div>
                        </div>
                        
                        {/* Option de saisie manuelle du taux de change */}
                        {formData.currencyCode !== 'USD' && (
                            <div className="border-t pt-4 mt-4">
                                <div className="flex items-center mb-3">
                                    <input
                                        type="checkbox"
                                        id="useManualRateExpense"
                                        checked={formData.useManualRate}
                                        onChange={(e) => setFormData(prev => ({ ...prev, useManualRate: e.target.checked }))}
                                        className="mr-2"
                                    />
                                    <label htmlFor="useManualRateExpense" className="text-sm font-medium text-gray-700">
                                        {t('finance_use_manual_rate') || 'Utiliser un taux de change manuel'}
                                    </label>
                                </div>
                                {formData.useManualRate && (
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            {t('finance_manual_exchange_rate') || 'Taux de change vers USD'} (1 {formData.currencyCode} = ? USD)
                                        </label>
                                        <input
                                            type="number"
                                            name="manualExchangeRate"
                                            value={formData.manualExchangeRate}
                                            onChange={handleChange}
                                            className="mt-1 block w-full p-2 border rounded-md"
                                            placeholder="Ex: 1.08"
                                            step="0.0001"
                                            min="0.0001"
                                            required={formData.useManualRate}
                                        />
                                        <p className="text-xs text-gray-500 mt-1">
                                            {t('finance_manual_rate_help') || 'Laissez vide pour utiliser le taux automatique de l\'API'}
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}

                        {!isRecurring && (
                            <>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                        <label className="block text-sm font-medium text-gray-700">{t('date')}</label>
                                        <input type="date" name="date" value={formData.date} onChange={handleChange} className="mt-1 block w-full p-2 border rounded-md" required/>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700">{t('payable_by')} (Optional)</label>
                                        <input type="date" name="dueDate" value={formData.dueDate} onChange={handleChange} className="mt-1 block w-full p-2 border rounded-md"/>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">{t('status')}</label>
                                    <select name="status" value={formData.status} onChange={handleChange} className="mt-1 block w-full p-2 border rounded-md">
                                        <option value="Unpaid">{t('unpaid')}</option>
                                        <option value="Paid">{t('paid')}</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        {t('link_to_budget')} <span className="text-xs text-gray-500 font-normal">({t('optional')})</span>
                                    </label>
                                    <select name="budgetItemId" value={formData.budgetItemId} onChange={handleChange} className="mt-1 block w-full p-2 border rounded-md">
                                        <option value="">{t('no_budget') || 'Aucun budget'}</option>
                                        {budgets.map(b => (
                                            <optgroup key={b.id} label={`${b.title} (${b.type})`}>
                                                {b.budgetLines.map(line => (
                                                    line.items.map(item => {
                                                        const spent = expenses.filter(e => e.budgetItemId === item.id).reduce((sum, e) => sum + e.amount, 0);
                                                        const remaining = item.amount - spent;
                                                        const budgetCurrency = b.currencyCode || 'USD';
                                                        const remainingText = remaining >= 0 
                                                            ? ` - Restant: ${formatBudgetCurrency(remaining, budgetCurrency)}` 
                                                            : ` - Dépassé: ${formatBudgetCurrency(Math.abs(remaining), budgetCurrency)}`;
                                                        return (
                                                            <option key={item.id} value={item.id}>
                                                                {line.title} → {item.description} ({formatBudgetCurrency(item.amount, budgetCurrency)}){remainingText}
                                                            </option>
                                                        );
                                                    })
                                                ))}
                                            </optgroup>
                                        ))}
                                    </select>
                                    <p className="mt-1 text-xs text-gray-500">
                                        {t('link_to_budget_help') || 'Lier cette dépense à un poste de budget pour suivre les dépenses par rapport au budget prévu.'}
                                    </p>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">{t('receipt')}</label>
                                    {receipt ? (
                                        <div className="mt-1 flex items-center justify-between p-2 border rounded-md bg-gray-50">
                                            <span className="text-sm truncate">{receipt.fileName}</span>
                                            <button type="button" onClick={() => setReceipt(null)} className="ml-2 text-red-500 hover:text-red-700 text-xs font-bold">{t('remove_receipt')}</button>
                                        </div>
                                    ) : (
                                        <input type="file" onChange={handleFileChange} className="mt-1 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100"/>
                                    )}
                                </div>
                            </>
                        )}
                        
                        {!isEditMode && (
                             <div className="pt-4 border-t">
                                <label className="flex items-center space-x-3 cursor-pointer">
                                    <input type="checkbox" checked={isRecurring} onChange={e => setIsRecurring(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"/>
                                    <span className="text-sm font-medium text-gray-700">{t('make_recurring')}</span>
                                </label>
                            </div>
                        )}

                        {isRecurring && (
                            <div className="space-y-4 pt-4 border-t border-dashed">
                                 <div>
                                    <label className="block text-sm font-medium text-gray-700">{t('frequency')}</label>
                                    <select name="frequency" value={recurringData.frequency} onChange={handleRecurringChange} className="mt-1 block w-full p-2 border rounded-md">
                                        <option value="Monthly">{t('monthly')}</option>
                                        <option value="Quarterly">{t('quarterly')}</option>
                                        <option value="Annually">{t('annually')}</option>
                                    </select>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700">{t('start_date')}</label>
                                        <input type="date" name="startDate" value={recurringData.startDate} onChange={handleRecurringChange} className="mt-1 block w-full p-2 border rounded-md" required/>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700">{t('end_date_optional')}</label>
                                        <input type="date" name="endDate" value={recurringData.endDate} onChange={handleRecurringChange} className="mt-1 block w-full p-2 border rounded-md"/>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="p-4 bg-gray-50 border-t flex justify-end space-x-2">
                        <button type="button" onClick={onClose} className="bg-gray-200 text-gray-800 px-4 py-2 rounded-lg font-semibold hover:bg-gray-300">{t('cancel')}</button>
                        <button type="submit" className="bg-emerald-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-emerald-700">{t('save')}</button>
                    </div>
                </form>
            </div>
        </div>
    );
}

const BudgetFormModal: React.FC<{
    budget: Budget | null;
    projects: Project[];
    onClose: () => void;
    onSave: (budget: Budget | Omit<Budget, 'id'>) => void;
}> = ({ budget, projects, onClose, onSave }) => {
    const { t } = useLocalization();
    const isEditMode = budget !== null;

    const [formData, setFormData] = useState({
        title: budget?.title || '',
        type: budget?.type || 'Project' as 'Project' | 'Office',
        amount: budget?.amount || '',
        currencyCode: budget?.currencyCode || 'USD',
        startDate: budget?.startDate || '',
        endDate: budget?.endDate || '',
        projectId: budget?.projectId || '',
        useManualRate: false,
        manualExchangeRate: budget?.exchangeRate ? String(budget.exchangeRate) : '',
    });

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({...prev, [name]: value }));
        if(name === 'type' && value === 'Office') {
            setFormData(prev => ({...prev, projectId: ''}));
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const dataToSave: any = {
            ...formData,
            amount: Number(formData.amount),
            currencyCode: formData.currencyCode as CurrencyCode,
            projectId: formData.projectId ? Number(formData.projectId) : undefined,
            budgetLines: budget?.budgetLines || [],
            transactionDate: formData.startDate, // Utiliser startDate comme date de transaction
        };
        
        // Ajouter le taux manuel si fourni
        if (formData.useManualRate && formData.manualExchangeRate) {
            dataToSave.manualExchangeRate = Number(formData.manualExchangeRate);
        }
        
        // Retirer les champs de formulaire non nécessaires
        delete dataToSave.useManualRate;
        
        onSave(isEditMode ? { ...budget, ...dataToSave } as Budget : dataToSave as Omit<Budget, 'id'>);
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-[60] p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-lg">
                <form onSubmit={handleSubmit}>
                    <div className="p-6 border-b"><h2 className="text-xl font-bold">{isEditMode ? t('edit_budget') : t('create_budget')}</h2></div>
                    <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">{t('budget_title')}</label>
                            <input name="title" value={formData.title} onChange={handleChange} className="mt-1 block w-full p-2 border rounded-md" required/>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700">{t('budget_type')}</label>
                                <select name="type" value={formData.type} onChange={handleChange} className="mt-1 block w-full p-2 border rounded-md">
                                    <option value="Project">{t('project_budget')}</option>
                                    <option value="Office">{t('office_management')}</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">{t('total_budget')}</label>
                                <input type="number" name="amount" value={formData.amount} onChange={handleChange} className="mt-1 block w-full p-2 border rounded-md" required/>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700">{t('finance_currency_field_label')}</label>
                                <select
                                    name="currencyCode"
                                    value={formData.currencyCode}
                                    onChange={handleChange}
                                    className="mt-1 block w-full p-2 border rounded-md"
                                >
                                    {currencyOptions.map(option => (
                                        <option key={option.code} value={option.code}>{option.label}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">{t('start_date')}</label>
                                <input type="date" name="startDate" value={formData.startDate} onChange={handleChange} className="mt-1 block w-full p-2 border rounded-md" required/>
                            </div>
                        </div>
                        
                        {/* Option de saisie manuelle du taux de change */}
                        {formData.currencyCode !== 'USD' && (
                            <div className="border-t pt-4 mt-4">
                                <div className="flex items-center mb-3">
                                    <input
                                        type="checkbox"
                                        id="useManualRateBudget"
                                        checked={formData.useManualRate}
                                        onChange={(e) => setFormData(prev => ({ ...prev, useManualRate: e.target.checked }))}
                                        className="mr-2"
                                    />
                                    <label htmlFor="useManualRateBudget" className="text-sm font-medium text-gray-700">
                                        {t('finance_use_manual_rate') || 'Utiliser un taux de change manuel'}
                                    </label>
                                </div>
                                {formData.useManualRate && (
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            {t('finance_manual_exchange_rate') || 'Taux de change vers USD'} (1 {formData.currencyCode} = ? USD)
                                        </label>
                                        <input
                                            type="number"
                                            name="manualExchangeRate"
                                            value={formData.manualExchangeRate}
                                            onChange={handleChange}
                                            className="mt-1 block w-full p-2 border rounded-md"
                                            placeholder="Ex: 1.08"
                                            step="0.0001"
                                            min="0.0001"
                                            required={formData.useManualRate}
                                        />
                                        <p className="text-xs text-gray-500 mt-1">
                                            {t('finance_manual_rate_help') || 'Laissez vide pour utiliser le taux automatique de l\'API'}
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}
                        {formData.type === 'Project' && (
                            <div>
                                <label className="block text-sm font-medium text-gray-700">{t('select_project')}</label>
                                <select name="projectId" value={formData.projectId} onChange={handleChange} className="mt-1 block w-full p-2 border rounded-md" required>
                                    <option value="" disabled>{t('select_project')}</option>
                                    {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                                </select>
                            </div>
                        )}
                             <div>
                                <label className="block text-sm font-medium text-gray-700">{t('end_date')}</label>
                                <input type="date" name="endDate" value={formData.endDate} onChange={handleChange} className="mt-1 block w-full p-2 border rounded-md" required/>
                        </div>
                    </div>
                    <div className="p-4 bg-gray-50 border-t flex justify-end space-x-2">
                        <button type="button" onClick={onClose} className="bg-gray-200 text-gray-800 px-4 py-2 rounded-lg font-semibold hover:bg-gray-300">{t('cancel')}</button>
                        <button type="submit" className="bg-emerald-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-emerald-700">{t('save')}</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const BudgetDetailModal: React.FC<{
    budget: Budget;
    expenses: Expense[];
    onClose: () => void;
    onUpdateBudget: (budget: Budget) => void;
    formatCurrencyFn?: (value: number, originalCurrency?: CurrencyCode, transactionDate?: string) => string;
}> = ({ budget, expenses, onClose, onUpdateBudget, formatCurrencyFn }) => {
    const { t, language } = useLocalization();
    const [editedBudget, setEditedBudget] = useState(budget);
    
    // Fonction de formatage de devise avec conversions intelligentes
    const formatCurrency = useCallback((value: number, currencyCode?: CurrencyCode, transactionDate?: string) => {
        // Si une fonction de formatage externe est fournie (avec conversions), l'utiliser
        if (formatCurrencyFn) {
            return formatCurrencyFn(value, currencyCode || budget.currencyCode, transactionDate || budget.startDate);
        }
        
        // Sinon, formatage simple
        const code = currencyCode || budget.currencyCode || 'USD';
        const locale = language === Language.FR ? 'fr-FR' : 'en-US';
        return CurrencyService.formatCurrency(value, code, locale);
    }, [language, budget.currencyCode, budget.startDate, formatCurrencyFn]);

    const handleLineChange = (lineIndex: number, newTitle: string) => {
        const newLines = [...editedBudget.budgetLines];
        newLines[lineIndex].title = newTitle;
        setEditedBudget({ ...editedBudget, budgetLines: newLines });
    };

    const handleItemChange = (lineIndex: number, itemIndex: number, field: 'description' | 'amount', value: string | number) => {
        const newLines = [...editedBudget.budgetLines];
        (newLines[lineIndex].items[itemIndex] as any)[field] = value;
        setEditedBudget({ ...editedBudget, budgetLines: newLines });
    };
    
    const addLine = () => {
        const newLineTitle = language === Language.FR ? 'Nouvelle Ligne Budgétaire' : 'New Budget Line';
        const newLine: BudgetLine = { id: `bl-${Date.now()}`, title: newLineTitle, items: [] };
        setEditedBudget({ ...editedBudget, budgetLines: [...editedBudget.budgetLines, newLine] });
    };

    const addItem = (lineIndex: number) => {
        const newItemDescription = language === Language.FR ? 'Nouveau Poste' : 'New Item';
        const newItem: BudgetItem = { id: `bi-${Date.now()}`, description: newItemDescription, amount: 0 };
        const newLines = [...editedBudget.budgetLines];
        newLines[lineIndex].items.push(newItem);
        setEditedBudget({ ...editedBudget, budgetLines: newLines });
    };
    
    const removeLine = (lineIndex: number) => {
        const newLines = editedBudget.budgetLines.filter((_, i) => i !== lineIndex);
        setEditedBudget({ ...editedBudget, budgetLines: newLines });
    };
    
    const removeItem = (lineIndex: number, itemIndex: number) => {
        const newLines = [...editedBudget.budgetLines];
        newLines[lineIndex].items = newLines[lineIndex].items.filter((_, i) => i !== itemIndex);
        setEditedBudget({ ...editedBudget, budgetLines: newLines });
    };
    
    const calculateSpent = (itemId: string) => expenses.filter(e => e.budgetItemId === itemId).reduce((sum, e) => sum + e.amount, 0);

    const handleSave = () => {
        onUpdateBudget(editedBudget);
        onClose();
    };

    const totalSpent = useMemo(() => {
        const allItemIds = new Set(editedBudget.budgetLines.flatMap(l => l.items.map(i => i.id)));
        return expenses.filter(e => e.budgetItemId && allItemIds.has(e.budgetItemId)).reduce((sum, e) => sum + e.amount, 0);
    }, [editedBudget, expenses]);
    
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-[60] p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
                <div className="p-6 border-b">
                    <div className="flex items-center justify-between mb-2">
                    <h2 className="text-2xl font-bold">{editedBudget.title}</h2>
                        {editedBudget.currencyCode && (
                            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                                {t('finance_currency_field_label')}: {editedBudget.currencyCode}
                            </span>
                        )}
                    </div>
                    <div className="flex flex-wrap gap-4 text-sm mt-2">
                        <span><strong>{t('total_budget')}:</strong> {formatCurrency(editedBudget.amount, editedBudget.currencyCode, editedBudget.startDate)}</span>
                        <span><strong>{t('amount_spent')}:</strong> {formatCurrency(totalSpent, editedBudget.currencyCode, editedBudget.startDate)}</span>
                        <span className={editedBudget.amount - totalSpent < 0 ? 'text-red-500' : 'text-green-500'}>
                            <strong>{t('remaining')}:</strong> {formatCurrency(editedBudget.amount - totalSpent, editedBudget.currencyCode, editedBudget.startDate)}
                        </span>
                    </div>
                </div>
                <div className="p-6 flex-grow overflow-y-auto space-y-4">
                    <h3 className="text-lg font-bold">{t('budget_lines')}</h3>
                    {editedBudget.budgetLines.map((line, lIndex) => (
                        <div key={line.id} className="p-4 border rounded-md bg-gray-50">
                            <div className="flex items-center justify-between mb-2">
                                <input value={line.title} onChange={e => handleLineChange(lIndex, e.target.value)} className="text-md font-semibold p-1 border-b w-full bg-transparent focus:outline-none focus:border-emerald-500" />
                                <button onClick={() => removeLine(lIndex)} className="ml-4 text-red-500 hover:text-red-700"><i className="fas fa-trash"></i></button>
                            </div>
                            <table className="w-full text-sm mt-2">
                                <thead className="text-left text-gray-500">
                                    <tr>
                                        <th className="py-1">{t('item_description')}</th>
                                        <th className="py-1 w-28 text-right">{t('planned_amount')}</th>
                                        <th className="py-1 w-28 text-right">{t('actual_spent')}</th>
                                        <th className="py-1 w-28 text-right">{t('remaining')}</th>
                                        <th className="py-1 w-12 text-center">{t('actions')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {line.items.map((item, iIndex) => {
                                        const spent = calculateSpent(item.id);
                                        const remaining = item.amount - spent;
                                        return (
                                        <tr key={item.id}>
                                            <td><input value={item.description} onChange={e => handleItemChange(lIndex, iIndex, 'description', e.target.value)} className="w-full p-1 bg-transparent focus:outline-none focus:bg-white rounded-md"/></td>
                                            <td className="text-right"><input type="number" value={item.amount} onChange={e => handleItemChange(lIndex, iIndex, 'amount', Number(e.target.value))} className="w-24 p-1 text-right bg-transparent focus:outline-none focus:bg-white rounded-md"/></td>
                                            <td className="text-right">{formatCurrency(spent, editedBudget.currencyCode, editedBudget.startDate)}</td>
                                            <td className={`text-right font-semibold ${remaining < 0 ? 'text-red-500' : 'text-green-600'}`}>{formatCurrency(remaining, editedBudget.currencyCode, editedBudget.startDate)}</td>
                                            <td className="text-center"><button onClick={() => removeItem(lIndex, iIndex)} className="text-gray-400 hover:text-red-500"><i className="fas fa-times-circle"></i></button></td>
                                        </tr>
                                    )})}
                                </tbody>
                            </table>
                            <button onClick={() => addItem(lIndex)} className="text-xs text-emerald-600 hover:text-emerald-800 mt-2"><i className="fas fa-plus mr-1"></i> {t('add_budget_item')}</button>
                        </div>
                    ))}
                    <button onClick={addLine} className="w-full border-dashed border-2 p-2 rounded-md hover:bg-gray-100 text-sm"><i className="fas fa-plus mr-2"></i>{t('add_budget_line')}</button>
                </div>
                <div className="p-4 bg-gray-50 border-t flex justify-end space-x-2">
                    <button type="button" onClick={onClose} className="bg-gray-200 text-gray-800 px-4 py-2 rounded-lg font-semibold hover:bg-gray-300">{t('cancel')}</button>
                    <button type="button" onClick={handleSave} className="bg-emerald-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-emerald-700">{t('save')}</button>
                </div>
            </div>
        </div>
    )
};

interface FinanceProps {
  invoices: Invoice[];
  expenses: Expense[];
  recurringInvoices: RecurringInvoice[];
  recurringExpenses: RecurringExpense[];
  budgets: Budget[];
  projects: Project[];
  onAddInvoice: (invoice: Omit<Invoice, 'id'>) => Promise<void> | void;
  onUpdateInvoice: (invoice: Invoice) => Promise<void> | void;
  onDeleteInvoice: (invoiceId: string) => Promise<void> | void;
  onAddExpense: (expense: Omit<Expense, 'id'>) => Promise<void> | void;
  onUpdateExpense: (expense: Expense) => Promise<void> | void;
  onDeleteExpense: (expenseId: string) => Promise<void> | void;
  onAddRecurringInvoice: (data: Omit<RecurringInvoice, 'id'>) => Promise<void> | void;
  onUpdateRecurringInvoice: (data: RecurringInvoice) => Promise<void> | void;
  onDeleteRecurringInvoice: (id: string) => Promise<void> | void;
  onAddRecurringExpense: (data: Omit<RecurringExpense, 'id'>) => Promise<void> | void;
  onUpdateRecurringExpense: (data: RecurringExpense) => Promise<void> | void;
  onDeleteRecurringExpense: (id: string) => Promise<void> | void;
  onAddBudget: (budget: Omit<Budget, 'id'>) => Promise<void> | void;
  onUpdateBudget: (budget: Budget) => Promise<void> | void;
  onDeleteBudget: (budgetId: string) => Promise<void> | void;
  /** Titre et sous-titre affichés (ex. pour le module Comptabilité) */
  moduleTitle?: string;
  moduleSubtitle?: string;
}


const Finance: React.FC<FinanceProps> = (props) => {
    const { 
        invoices, expenses, recurringInvoices, recurringExpenses, budgets, projects,
        onAddInvoice, onUpdateInvoice, onDeleteInvoice, 
        onAddExpense, onUpdateExpense, onDeleteExpense,
        onAddRecurringInvoice, onUpdateRecurringInvoice, onDeleteRecurringInvoice,
        onAddRecurringExpense, onUpdateRecurringExpense, onDeleteRecurringExpense,
        onAddBudget, onUpdateBudget, onDeleteBudget
    } = props;
    const { t, language } = useLocalization();
    const { user } = useAuth();
    const [activeTab, setActiveTab] = useState<'invoices' | 'expenses' | 'recurring' | 'budgets' | 'analytics'>('invoices');
    const [activeRecurringTab, setActiveRecurringTab] = useState<'invoices' | 'expenses'>('invoices');
    
    const [isInvoiceModalOpen, setInvoiceModalOpen] = useState(false);
    const [isExpenseModalOpen, setExpenseModalOpen] = useState(false);
    const [isBudgetModalOpen, setBudgetModalOpen] = useState(false);
    const [isBudgetDetailModalOpen, setBudgetDetailModalOpen] = useState(false);
    const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
    const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
    const [editingBudget, setEditingBudget] = useState<Budget | null>(null);
    const [viewingBudget, setViewingBudget] = useState<Budget | null>(null);
    const [deletingId, setDeletingId] = useState<{type: 'invoice' | 'expense' | 'recurringInvoice' | 'recurringExpense' | 'budget', id: string} | null>(null);
    const [viewingReceipt, setViewingReceipt] = useState<Receipt | null>(null);
    
    // États pour recherche, filtres, tri et vue
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'sent' | 'paid' | 'overdue' | 'partially_paid'>('all');
    const [expenseStatusFilter, setExpenseStatusFilter] = useState<'all' | 'paid' | 'unpaid'>('all');
    const [sortBy, setSortBy] = useState<'date' | 'amount' | 'status' | 'client'>('date');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
    const [viewMode, setViewMode] = useState<'grid' | 'list' | 'compact'>('list');

    const getLocale = useMemo(() => (language === Language.FR ? 'fr-FR' : 'en-US'), [language]);

    // Fonction de formatage simple - affiche toujours dans la devise originale
    const formatCurrency = useCallback((
        value: number,
        originalCurrency?: CurrencyCode,
        transactionDate?: string
    ) => {
        const code = originalCurrency || 'USD';
        return CurrencyService.formatCurrency(value, code, getLocale);
    }, [getLocale]);


    // Dashboard Metrics Calculations
    const totalRevenue = useMemo(() => {
        const paidInvoices = invoices.filter(inv => inv.status === 'Paid').reduce((sum, inv) => sum + inv.amount, 0);
        const partiallyPaidInvoices = invoices.filter(inv => inv.status === 'Partially Paid').reduce((sum, inv) => sum + (inv.paidAmount || 0), 0);
        return paidInvoices + partiallyPaidInvoices;
    }, [invoices]);

    const totalExpenses = useMemo(() => expenses.reduce((sum, exp) => sum + exp.amount, 0), [expenses]);
    const netIncome = totalRevenue - totalExpenses;
    
    const totalOutstandingInvoices = useMemo(() => {
        return invoices.reduce((sum, inv) => {
            switch(inv.status) {
                case 'Sent':
                case 'Overdue':
                    return sum + inv.amount;
                case 'Partially Paid':
                    return sum + (inv.amount - (inv.paidAmount || 0));
                default: // Draft, Paid
                    return sum;
            }
        }, 0);
    }, [invoices]);

    const totalDueExpenses = useMemo(() => {
        return expenses
            .filter(exp => exp.status === 'Unpaid')
            .reduce((sum, exp) => sum + exp.amount, 0);
    }, [expenses]);

    const averagePaymentTime = useMemo(() => {
        const paidInvoices = invoices.filter(inv => inv.status === 'Paid' && inv.paidDate);
        if (paidInvoices.length === 0) {
            return null;
        }

        const totalDaysDiff = paidInvoices.reduce((sum, inv) => {
            const dueDate = new Date(inv.dueDate);
            const paidDate = new Date(inv.paidDate!);
            const diffTime = paidDate.getTime() - dueDate.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            return sum + diffDays;
        }, 0);

        return Math.round(totalDaysDiff / paidInvoices.length);
    }, [invoices]);

    const formattedStats = useMemo(() => ({
        totalRevenue: formatCurrency(totalRevenue),
        totalExpenses: formatCurrency(totalExpenses),
        netIncome: formatCurrency(netIncome),
        outstanding: formatCurrency(totalOutstandingInvoices),
        dueExpenses: formatCurrency(totalDueExpenses)
    }), [formatCurrency, totalRevenue, totalExpenses, netIncome, totalOutstandingInvoices, totalDueExpenses]);

    const budgetsWithSpent = useMemo(() => {
        return budgets.map(budget => {
            const allItemIds = new Set(budget.budgetLines.flatMap(l => l.items.map(i => i.id)));
            const spent = expenses
                .filter(exp => exp.budgetItemId && allItemIds.has(exp.budgetItemId))
                .reduce((sum, exp) => sum + exp.amount, 0);
            return { ...budget, spentAmount: spent };
        });
    }, [budgets, expenses]);

    // Filtrage et tri des invoices
    const filteredInvoices = useMemo(() => {
        console.log('🔍 Finance.filteredInvoices - Début filtrage:', {
            totalInvoices: invoices.length,
            statusFilter,
            invoicesStatuses: invoices.map(inv => ({ 
                id: inv.id, 
                status: inv.status, 
                invoiceNumber: inv.invoiceNumber
            }))
        });
        
        let filtered = invoices.filter(inv => {
            // Recherche
            const matchesSearch = searchQuery === '' || 
                inv.invoiceNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
                inv.clientName.toLowerCase().includes(searchQuery.toLowerCase());
            
            // Filtre par status - Utiliser le statut original de la facture, pas getInvoiceStatus
            let matchesStatus = false;
            if (statusFilter === 'all') {
                matchesStatus = true;
            } else if (statusFilter === 'draft') {
                matchesStatus = inv.status === 'Draft';
            } else if (statusFilter === 'sent') {
                matchesStatus = inv.status === 'Sent';
            } else if (statusFilter === 'paid') {
                matchesStatus = inv.status === 'Paid';
            } else if (statusFilter === 'partially_paid') {
                matchesStatus = inv.status === 'Partially Paid';
            } else if (statusFilter === 'overdue') {
                // Pour "overdue", utiliser getInvoiceStatus pour détecter les factures en retard
                matchesStatus = getInvoiceStatus(inv) === 'Overdue';
            }
            
            return matchesSearch && matchesStatus;
        });

        console.log('📊 Finance.filteredInvoices - Après filtrage:', {
            filteredCount: filtered.length,
            allStatusesInFiltered: [...new Set(filtered.map(inv => inv.status))]
        });

        // Tri
        filtered.sort((a, b) => {
            let aValue: any, bValue: any;
            if (sortBy === 'date') {
                aValue = new Date(a.dueDate).getTime();
                bValue = new Date(b.dueDate).getTime();
            } else if (sortBy === 'amount') {
                aValue = a.amount;
                bValue = b.amount;
            } else if (sortBy === 'status') {
                aValue = a.status;
                bValue = b.status;
            } else if (sortBy === 'client') {
                aValue = a.clientName.toLowerCase();
                bValue = b.clientName.toLowerCase();
            }
            
            if (sortOrder === 'asc') {
                return aValue > bValue ? 1 : -1;
            } else {
                return aValue < bValue ? 1 : -1;
            }
        });

        return filtered;
    }, [invoices, searchQuery, statusFilter, sortBy, sortOrder]);

    // Filtrage et tri des expenses
    const filteredExpenses = useMemo(() => {
        let filtered = expenses.filter(exp => {
            // Recherche
            const matchesSearch = searchQuery === '' || 
                exp.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
                exp.category.toLowerCase().includes(searchQuery.toLowerCase());
            
            // Filtre par status
            const matchesStatus = expenseStatusFilter === 'all' || 
                (expenseStatusFilter === 'paid' && exp.status === 'Paid') ||
                (expenseStatusFilter === 'unpaid' && exp.status === 'Unpaid');
            
            return matchesSearch && matchesStatus;
        });

        // Tri
        filtered.sort((a, b) => {
            let aValue: any, bValue: any;
            if (sortBy === 'date') {
                aValue = new Date(a.date).getTime();
                bValue = new Date(b.date).getTime();
            } else if (sortBy === 'amount') {
                aValue = a.amount;
                bValue = b.amount;
            } else if (sortBy === 'status') {
                aValue = a.status;
                bValue = b.status;
            } else {
                aValue = a.description.toLowerCase();
                bValue = b.description.toLowerCase();
            }
            
            if (sortOrder === 'asc') {
                return aValue > bValue ? 1 : -1;
            } else {
                return aValue < bValue ? 1 : -1;
            }
        });

        return filtered;
    }, [expenses, searchQuery, expenseStatusFilter, sortBy, sortOrder]);

    const userProfileId = useMemo(() => {
        if (!user) return null;
        if (user.profileId) return String(user.profileId);
        if (user.id) return String(user.id);
        return null;
    }, [user?.profileId, user?.id]);

    const hasManagementRole = useMemo(() => {
        if (!user) return false;
        return RESOURCE_MANAGEMENT_ROLES.includes(user.role);
    }, [user]);

    const canManage = hasManagementRole;

    const canManageEntity = useCallback(
        (ownerId?: string | null) => {
            if (!user) return false;
            const normalizedOwner = ownerId ? ownerId.toString() : null;
            return Boolean(
                (userProfileId && normalizedOwner && normalizedOwner === userProfileId) ||
                hasManagementRole
            );
        },
        [user, userProfileId, hasManagementRole]
    );
    
    const handleOpenInvoiceModal = (invoice: Invoice | null = null) => {
        setEditingInvoice(invoice);
        setInvoiceModalOpen(true);
    }
    const handleOpenExpenseModal = (expense: Expense | null = null) => {
        setEditingExpense(expense);
        setExpenseModalOpen(true);
    }
    const handleOpenBudgetModal = (budget: Budget | null = null) => {
        setEditingBudget(budget);
        setBudgetModalOpen(true);
    }
    const handleOpenBudgetDetailModal = (budget: Budget) => {
        setViewingBudget(budget);
        setBudgetDetailModalOpen(true);
    };

    const handleSaveInvoice = async (data: Invoice | Omit<Invoice, 'id'>) => {
        try {
            if('id' in data) { 
                await onUpdateInvoice(data); 
            } else { 
                await onAddInvoice(data);
            }
        setInvoiceModalOpen(false);
        } catch (error: any) {
            console.error('❌ Erreur sauvegarde facture:', error);
            
            // Détecter l'erreur de contrainte CHECK pour paiement partiel
            const isConstraintError = error?.code === '23514' || 
                                     error?.message?.includes('check constraint') || 
                                     error?.message?.includes('invoices_status_check') ||
                                     error?.message?.includes('partially_paid');
            
            if (isConstraintError) {
                alert(t('finance_partial_payment_constraint_error'));
            } else {
                alert(t('finance_save_invoice_error'));
            }
        }
    }
    
    const handleSaveExpense = async (data: Expense | Omit<Expense, 'id'>) => {
        if('id' in data) { await onUpdateExpense(data); }
        else { await onAddExpense(data); }
        setExpenseModalOpen(false);
    }

    const handleSaveBudget = async (data: Budget | Omit<Budget, 'id'>) => {
        if('id' in data) { await onUpdateBudget(data); }
        else { await onAddBudget(data); }
        setBudgetModalOpen(false);
    }
    
    const handleSaveRecurringInvoice = async (data: Omit<RecurringInvoice, 'id'>) => {
        await onAddRecurringInvoice(data);
        setInvoiceModalOpen(false);
    };

    const handleSaveRecurringExpense = async (data: Omit<RecurringExpense, 'id'>) => {
        await onAddRecurringExpense(data);
        setExpenseModalOpen(false);
    };
    
    const confirmDelete = async () => {
        if(!deletingId) return;
        const { type, id } = deletingId;

        const resolveOwnerId = (): string | null => {
            switch (type) {
                case 'invoice': {
                    const target = invoices.find(inv => inv.id === id);
                    return target?.createdById ? String(target.createdById) : null;
                }
                case 'expense': {
                    const target = expenses.find(exp => exp.id === id);
                    return target?.createdById ? String(target.createdById) : null;
                }
                case 'recurringInvoice': {
                    const target = recurringInvoices.find(ri => ri.id === id);
                    return target?.createdById ? String(target.createdById) : null;
                }
                case 'recurringExpense': {
                    const target = recurringExpenses.find(re => re.id === id);
                    return target?.createdById ? String(target.createdById) : null;
                }
                case 'budget': {
                    const target = budgets.find(b => b.id === id);
                    return target?.createdById ? String(target.createdById) : null;
                }
                default:
                    return null;
            }
        };

        if (!canManageEntity(resolveOwnerId())) {
            alert(t('project_permission_error'));
            setDeletingId(null);
            return;
        }

        if(type === 'invoice') { await onDeleteInvoice(id); }
        else if (type === 'expense') { await onDeleteExpense(id); }
        else if (type === 'recurringInvoice') { await onDeleteRecurringInvoice(id); }
        else if (type === 'recurringExpense') { await onDeleteRecurringExpense(id); }
        else if (type === 'budget') { await onDeleteBudget(id); }
        setDeletingId(null);
    }
    
    const getInvoiceStatus = (invoice: Invoice): Invoice['status'] => {
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Normalize today's date
        const dueDate = new Date(invoice.dueDate);
        if (invoice.status !== 'Paid' && invoice.status !== 'Partially Paid' && invoice.status !== 'Draft' && dueDate < today) {
            return 'Overdue';
        }
        return invoice.status;
    }

    const handleToggleExpenseStatus = async (expense: Expense) => {
        if (!canManageEntity(expense.createdById)) {
            alert(t('project_permission_error'));
            return;
        }
        const newStatus = expense.status === 'Paid' ? 'Unpaid' : 'Paid';
        await onUpdateExpense({ ...expense, status: newStatus });
    };

    const getNextDueDate = (item: RecurringInvoice | RecurringExpense): string => {
        const lastGen = new Date(item.lastGeneratedDate);
        if (item.frequency === 'Monthly') lastGen.setMonth(lastGen.getMonth() + 1);
        else if (item.frequency === 'Quarterly') lastGen.setMonth(lastGen.getMonth() + 3);
        else if (item.frequency === 'Annually') lastGen.setFullYear(lastGen.getFullYear() + 1);
        return lastGen.toISOString().split('T')[0];
    };

    return (
    <>
        <div className="min-h-screen bg-gray-50">
            {/* Header moderne avec gradient */}
            <div className="bg-gradient-to-r from-emerald-600 to-blue-600 text-white shadow-lg">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                    <div className="flex items-center justify-between">
                        <div className="flex-1">
                            <h1 className="text-4xl font-bold mb-2">{props.moduleTitle ?? t('finance_title')}</h1>
                            <p className="text-emerald-50 text-sm">
                                {props.moduleSubtitle ?? t('finance_subtitle')}
                            </p>
            </div>
                    {canManage && activeTab !== 'recurring' && (
                        <button 
                          onClick={
                              activeTab === 'invoices' ? () => handleOpenInvoiceModal() :
                              activeTab === 'expenses' ? () => handleOpenExpenseModal() :
                              () => handleOpenBudgetModal()
                          } 
                                className="bg-white text-emerald-600 font-bold py-2 px-4 rounded-lg hover:bg-emerald-50 flex items-center shadow-md">
                            <i className="fas fa-plus mr-2"></i>
                            {
                                activeTab === 'invoices' ? t('new_invoice') :
                                activeTab === 'expenses' ? t('new_expense') :
                                t('new_budget')
                            }
                        </button>
                    )}
                    </div>
                </div>
            </div>


            {/* Alertes visuelles */}
            {(() => {
                const overdueInvoices = invoices.filter(inv => {
                    if (inv.status === 'Paid' || inv.status === 'Draft') return false;
                    const dueDate = new Date(inv.dueDate);
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    return dueDate < today;
                });
                
                const overBudget = budgets.filter(budget => {
                    const allItemIds = new Set(budget.budgetLines.flatMap(l => l.items.map(i => i.id)));
                    const spent = expenses
                        .filter(exp => exp.budgetItemId && allItemIds.has(exp.budgetItemId))
                        .reduce((sum, exp) => sum + exp.amount, 0);
                    return spent > budget.amount;
                });

                if (overdueInvoices.length > 0 || overBudget.length > 0) {
                    return (
                        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-6">
                            <div className="space-y-3">
                                {overdueInvoices.length > 0 && (
                                    <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-lg shadow-sm">
                                        <div className="flex items-center">
                                            <i className="fas fa-exclamation-triangle text-red-500 text-xl mr-3"></i>
                                            <div className="flex-1">
                                                <h3 className="text-sm font-bold text-red-800">
                                                    {t('overdue_invoices_alert') || `${overdueInvoices.length} Facture(s) en retard`}
                                                </h3>
                                                <p className="text-sm text-red-700 mt-1">
                                                    {t('overdue_invoices_message') || 'Vous avez des factures en retard. Veuillez suivre les paiements.'}
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => {
                                                    setActiveTab('invoices');
                                                    setStatusFilter('overdue');
                                                }}
                                                className="ml-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-semibold"
                                            >
                                                {t('view') || 'Voir'}
                                            </button>
                                        </div>
                                    </div>
                                )}
                                {overBudget.length > 0 && (
                                    <div className="bg-orange-50 border-l-4 border-orange-500 p-4 rounded-lg shadow-sm">
                                        <div className="flex items-center">
                                            <i className="fas fa-chart-line text-orange-500 text-xl mr-3"></i>
                                            <div className="flex-1">
                                                <h3 className="text-sm font-bold text-orange-800">
                                                    {t('budgets_exceeded_alert') || `${overBudget.length} Budget(s) dépassé(s)`}
                                                </h3>
                                                <p className="text-sm text-orange-700 mt-1">
                                                    {t('budgets_exceeded_message') || 'Certains budgets ont été dépassés. Vérifiez vos dépenses.'}
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => setActiveTab('budgets')}
                                                className="ml-4 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 text-sm font-semibold"
                                            >
                                                {t('view') || 'Voir'}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                }
                return null;
            })()}

            {/* Métriques Power BI style */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-6 mb-8">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-200">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-gray-600">{t('total_revenue')}</span>
                            <i className="fas fa-arrow-up text-2xl text-green-500"></i>
                        </div>
                        <p className="text-3xl font-bold text-gray-900">{formattedStats.totalRevenue}</p>
                    </div>
                    <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-200">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-gray-600">{t('total_expenses')}</span>
                            <i className="fas fa-arrow-down text-2xl text-red-500"></i>
                        </div>
                        <p className="text-3xl font-bold text-gray-900">{formattedStats.totalExpenses}</p>
                    </div>
                    <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-200">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-gray-600">{t('net_income')}</span>
                            <i className="fas fa-dollar-sign text-2xl text-blue-500"></i>
                        </div>
                        <p className={`text-3xl font-bold ${netIncome >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {formattedStats.netIncome}
                        </p>
                    </div>
                    <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-200">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-gray-600">{t('total_outstanding_invoices')}</span>
                            <i className="fas fa-file-invoice text-2xl text-orange-500"></i>
                        </div>
                        <p className="text-3xl font-bold text-gray-900">{formattedStats.outstanding}</p>
                    </div>
                    <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-200">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-gray-600">{t('total_due_expenses')}</span>
                            <i className="fas fa-money-bill-wave text-2xl text-yellow-500"></i>
                        </div>
                        <p className="text-3xl font-bold text-gray-900">{formattedStats.dueExpenses}</p>
                    </div>
                    <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-200">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-gray-600">{t('average_payment_time')}</span>
                            <i className="fas fa-hourglass-half text-2xl text-purple-500"></i>
                        </div>
                        <p className="text-3xl font-bold text-gray-900">
                            {averagePaymentTime !== null ? `${averagePaymentTime} ${t('days')}` : 'N/A'}
                        </p>
                    </div>
                </div>
            </div>

            {/* Contenu principal avec tabs */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-8">
                {/* Navigation tabs moderne */}
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
                    <div className="border-b border-gray-200">
                        <nav className="flex space-x-8 px-6" aria-label="Tabs">
                            <button 
                                onClick={() => setActiveTab('invoices')} 
                                className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                                    activeTab === 'invoices' 
                                        ? 'border-emerald-500 text-emerald-600' 
                                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                }`}
                            >
                                {t('invoices')} ({invoices.length})
                            </button>
                            <button 
                                onClick={() => setActiveTab('expenses')} 
                                className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                                    activeTab === 'expenses' 
                                        ? 'border-emerald-500 text-emerald-600' 
                                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                }`}
                            >
                                {t('expenses')} ({expenses.length})
                            </button>
                            <button 
                                onClick={() => setActiveTab('recurring')} 
                                className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                                    activeTab === 'recurring' 
                                        ? 'border-emerald-500 text-emerald-600' 
                                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                }`}
                            >
                                {t('recurring')} ({recurringInvoices.length + recurringExpenses.length})
                            </button>
                            <button 
                                onClick={() => setActiveTab('budgets')} 
                                className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                                    activeTab === 'budgets' 
                                        ? 'border-emerald-500 text-emerald-600' 
                                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                }`}
                            >
                                {t('budgets')} ({budgets.length})
                            </button>
                            <button 
                                onClick={() => setActiveTab('analytics')} 
                                className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                                    activeTab === 'analytics' 
                                        ? 'border-emerald-500 text-emerald-600' 
                                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                }`}
                            >
                                <i className="fas fa-chart-line mr-2"></i>
                                {t('analytics') || 'Analytics'}
                            </button>
                        </nav>
                    </div>
                </div>

                <div className="mt-6">
                    {activeTab === 'invoices' && (
                        <>
                            {/* Barre de recherche et filtres pour Invoices */}
                            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
                                <div className="flex flex-wrap items-center gap-4">
                                    {/* Recherche */}
                                    <div className="flex-1 min-w-[200px]">
                                        <div className="relative">
                                            <i className="fas fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"></i>
                                            <input
                                                type="text"
                                                placeholder={t('search') || 'Rechercher...'}
                                                value={searchQuery}
                                                onChange={(e) => setSearchQuery(e.target.value)}
                                                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                                            />
                                        </div>
                                    </div>

                                    {/* Filtre par statut */}
                                    <select
                                        value={statusFilter}
                                        onChange={(e) => setStatusFilter(e.target.value as any)}
                                        className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                                    >
                                        <option value="all">{t('all_statuses') || 'Tous les statuts'}</option>
                                        <option value="draft">{t('draft') || 'Brouillon'}</option>
                                        <option value="sent">{t('sent')}</option>
                                        <option value="paid">{t('paid')}</option>
                                        <option value="partially_paid">{t('partially_paid')}</option>
                                        <option value="overdue">{t('overdue') || 'En retard'}</option>
                                    </select>

                                    {/* Tri */}
                                    <select
                                        value={sortBy}
                                        onChange={(e) => setSortBy(e.target.value as any)}
                                        className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                                    >
                                        <option value="date">{t('sort_by_date') || 'Trier par date'}</option>
                                        <option value="amount">{t('sort_by_amount') || 'Trier par montant'}</option>
                                        <option value="status">{t('sort_by_status') || 'Trier par statut'}</option>
                                        <option value="client">{t('sort_by_client') || 'Trier par client'}</option>
                                    </select>

                                    {/* Ordre de tri */}
                                    <button
                                        onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                                        className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center"
                                        title={sortOrder === 'asc' ? t('sort_ascending') : t('sort_descending')}
                                    >
                                        <i className={`fas ${sortOrder === 'asc' ? 'fa-sort-up' : 'fa-sort-down'} mr-2`}></i>
                                        {t(sortOrder === 'asc' ? 'sort_ascending' : 'sort_descending')}
                                    </button>
                                </div>

                                {/* Compteur de résultats */}
                                <div className="mt-3 pt-3 border-t border-gray-200 text-sm text-gray-600">
                                    {filteredInvoices.length}{' '}
                                    {filteredInvoices.length > 1 ? t('finance_invoice_found_plural') : t('finance_invoice_found_singular')}
                                    {searchQuery && (
                                        <span className="ml-2">
                                            pour "{searchQuery}"
                                        </span>
                                    )}
                                </div>
                            </div>

                            {filteredInvoices.length === 0 ? (
                                <div className="bg-white rounded-lg shadow-lg p-12 text-center">
                                    <i className="fas fa-file-invoice text-6xl text-gray-300 mb-4"></i>
                                    <p className="text-gray-600 text-lg mb-2">
                                        {searchQuery || statusFilter !== 'all' ? t('finance_no_invoice_match') : t('finance_no_invoice')}
                                    </p>
                                    {canManage && (
                                        <button
                                            onClick={() => handleOpenInvoiceModal()}
                                            className="mt-4 bg-emerald-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-emerald-700"
                                        >
                                            <i className="fas fa-plus mr-2"></i>
                                            {t('new_invoice')}
                                        </button>
                                    )}
                                </div>
                            ) : (
                        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50 text-left text-xs text-gray-700 uppercase">
                                    <tr>
                                        <th className="px-6 py-3">{t('invoice_number')}</th>
                                        <th className="px-6 py-3">{t('client_name')}</th>
                                        <th className="px-6 py-3">{t('amount')}</th>
                                        <th className="px-6 py-3">{t('due_date')}</th>
                                        <th className="px-6 py-3">{t('status')}</th>
                                        <th className="px-6 py-3">{t('receipt')}</th>
                                        <th className="px-6 py-3 text-right">{t('actions')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {filteredInvoices.map(inv => {
                                        const finalStatus = getInvoiceStatus(inv);
                                        return (
                                            <tr key={inv.id} className="hover:bg-gray-50">
                                                <td className="px-6 py-4 font-medium text-gray-900">{inv.invoiceNumber}</td>
                                                <td className="px-6 py-4">{inv.clientName}</td>
                                                <td className="px-6 py-4">
                                                    {inv.status === 'Partially Paid' ? (
                                                        <div className="flex flex-col">
                                                            <span className="font-medium">{formatCurrency(inv.paidAmount || 0, inv.currencyCode, inv.transactionDate)} / {formatCurrency(inv.amount, inv.currencyCode, inv.transactionDate)}</span>
                                                            <span className="text-xs text-gray-500">{t('remaining')}: {formatCurrency(inv.amount - (inv.paidAmount || 0), inv.currencyCode, inv.transactionDate)}</span>
                                                        </div>
                                                    ) : (
                                                        <div className="flex flex-col">
                                                            <span>{formatCurrency(inv.amount, inv.currencyCode, inv.transactionDate)}</span>
                                                            {inv.currencyCode && inv.currencyCode !== 'USD' && inv.exchangeRate && inv.transactionDate && (
                                                                <ExchangeGainLossIndicator 
                                                                    amount={inv.amount} 
                                                                    currency={inv.currencyCode} 
                                                                    exchangeRate={inv.exchangeRate}
                                                                    transactionDate={inv.transactionDate}
                                                                    size="sm"
                                                                />
                                                            )}
                                                        </div>
                                                    )}
                                                </td>
                                                <td className={`px-6 py-4 ${finalStatus === 'Overdue' ? 'font-bold text-red-600' : ''}`}>{inv.dueDate}</td>
                                                <td className="px-6 py-4"><span className={`px-2 py-1 text-xs font-semibold rounded-full ${statusStyles[finalStatus]}`}>{t(finalStatus.replace(/\s+/g, '_').toLowerCase())}</span></td>
                                                <td className="px-6 py-4">
                                                    {inv.receipt ? (
                                                        <div className="flex items-center space-x-3">
                                                            <button onClick={() => setViewingReceipt(inv.receipt!)} className="text-gray-500 hover:text-emerald-600" title={t('view_receipt')}><i className="fas fa-eye"></i></button>
                                                            <a href={inv.receipt.dataUrl} download={inv.receipt.fileName} className="text-gray-500 hover:text-emerald-600" title={t('download_receipt')}><i className="fas fa-download"></i></a>
                                                        </div>
                                                    ) : (<span className="text-gray-400 text-xs">{t('no_receipt_attached')}</span>)}
                                                </td>
                                                <td className="px-6 py-4 text-right space-x-2">
                                                    {canManageEntity(inv.createdById) && (
                                                        <>
                                                    <button onClick={() => handleOpenInvoiceModal(inv)} className="font-medium text-blue-600 hover:text-blue-800">{t('edit')}</button>
                                                    <button onClick={() => setDeletingId({type: 'invoice', id: inv.id})} className="font-medium text-red-600 hover:text-red-800">{t('delete')}</button>
                                                        </>
                                                    )}
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                        </div>
                            )}
                        </>
                    )}
                    {activeTab === 'expenses' && (
                        <>
                            {/* Barre de recherche et filtres pour Expenses */}
                            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
                                <div className="flex flex-wrap items-center gap-4">
                                    {/* Recherche */}
                                    <div className="flex-1 min-w-[200px]">
                                        <div className="relative">
                                            <i className="fas fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"></i>
                                            <input
                                                type="text"
                                                placeholder={t('search') || 'Rechercher...'}
                                                value={searchQuery}
                                                onChange={(e) => setSearchQuery(e.target.value)}
                                                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                                            />
                                        </div>
                                    </div>

                                    {/* Filtre par statut */}
                                    <select
                                        value={expenseStatusFilter}
                                        onChange={(e) => setExpenseStatusFilter(e.target.value as any)}
                                        className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                                    >
                                        <option value="all">{t('all_statuses') || 'Tous les statuts'}</option>
                                        <option value="paid">{t('paid')}</option>
                                        <option value="unpaid">{t('unpaid')}</option>
                                    </select>

                                    {/* Tri */}
                                    <select
                                        value={sortBy}
                                        onChange={(e) => setSortBy(e.target.value as any)}
                                        className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                                    >
                                        <option value="date">{t('sort_by_date') || 'Trier par date'}</option>
                                        <option value="amount">{t('sort_by_amount') || 'Trier par montant'}</option>
                                        <option value="status">{t('sort_by_status') || 'Trier par statut'}</option>
                                    </select>

                                    {/* Ordre de tri */}
                                    <button
                                        onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                                        className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center"
                                        title={sortOrder === 'asc' ? t('sort_ascending') : t('sort_descending')}
                                    >
                                        <i className={`fas ${sortOrder === 'asc' ? 'fa-sort-up' : 'fa-sort-down'} mr-2`}></i>
                                        {t(sortOrder === 'asc' ? 'sort_ascending' : 'sort_descending')}
                                    </button>
                                </div>

                                {/* Compteur de résultats */}
                                <div className="mt-3 pt-3 border-t border-gray-200 text-sm text-gray-600">
                                    {filteredExpenses.length}{' '}
                                    {filteredExpenses.length > 1 ? t('finance_expense_found_plural') : t('finance_expense_found_singular')}
                                    {searchQuery && (
                                        <span className="ml-2">
                                            pour "{searchQuery}"
                                        </span>
                                    )}
                                </div>
                            </div>

                            {filteredExpenses.length === 0 ? (
                                <div className="bg-white rounded-lg shadow-lg p-12 text-center">
                                    <i className="fas fa-money-bill-wave text-6xl text-gray-300 mb-4"></i>
                                    <p className="text-gray-600 text-lg mb-2">
                                        {searchQuery || expenseStatusFilter !== 'all' ? t('finance_no_expense_match') : t('finance_no_expense')}
                                    </p>
                                    {canManage && (
                                        <button
                                            onClick={() => handleOpenExpenseModal()}
                                            className="mt-4 bg-emerald-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-emerald-700"
                                        >
                                            <i className="fas fa-plus mr-2"></i>
                                            {t('new_expense')}
                                        </button>
                                    )}
                                </div>
                            ) : (
                         <div className="bg-white rounded-lg shadow-lg overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50 text-left text-xs text-gray-700 uppercase">
                                    <tr>
                                        <th className="px-6 py-3">{t('status')}</th>
                                        <th className="px-6 py-3">{t('date')}</th>
                                        <th className="px-6 py-3">{t('description')}</th>
                                        <th className="px-6 py-3">{t('amount')}</th>
                                        <th className="px-6 py-3">{t('payable_by')}</th>
                                        <th className="px-6 py-3">{t('receipt')}</th>
                                        <th className="px-6 py-3 text-right">{t('actions')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                     {filteredExpenses.map(exp => (
                                    <tr key={exp.id} className={`hover:bg-gray-50 ${exp.status === 'Paid' ? 'bg-emerald-50' : ''}`}>
                                        <td className="px-6 py-4">
                                             <div className="flex items-center space-x-2">
                                                <span className={`px-2 py-1 text-xs font-semibold rounded-full ${exp.status === 'Paid' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                                                    {t(exp.status.toLowerCase())}
                                                </span>
                                                <button
                                                    onClick={() => handleToggleExpenseStatus(exp)}
                                                    className={`relative inline-flex flex-shrink-0 h-6 w-11 border-2 border-transparent rounded-full cursor-pointer transition-colors ease-in-out duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 ${exp.status === 'Paid' ? 'bg-emerald-600' : 'bg-gray-200'}`}
                                                    role="switch"
                                                    aria-checked={exp.status === 'Paid'}
                                                    title={`Mark as ${exp.status === 'Paid' ? t('unpaid') : t('paid')}`}
                                                >
                                                    <span
                                                        aria-hidden="true"
                                                        className={`inline-block w-5 h-5 transform bg-white rounded-full shadow-lg ring-0 transition ease-in-out duration-200 ${exp.status === 'Paid' ? 'translate-x-5' : 'translate-x-0'}`}
                                                    />
                                                </button>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">{exp.date}</td>
                                        <td className="px-6 py-4 font-medium text-gray-900">
                                            <div className="flex items-center space-x-2">
                                                <span>{exp.description}</span>
                                                {exp.budgetItemId && (() => {
                                                    const budget = budgets.find(b => 
                                                        b.budgetLines.some(line => 
                                                            line.items.some(item => item.id === exp.budgetItemId)
                                                        )
                                                    );
                                                    const budgetLine = budget?.budgetLines.find(line => 
                                                        line.items.some(item => item.id === exp.budgetItemId)
                                                    );
                                                    const budgetItem = budgetLine?.items.find(item => item.id === exp.budgetItemId);
                                                    return budget && budgetItem ? (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800" title={`Budget: ${budget.title} - ${budgetLine?.title} - ${budgetItem.description}`}>
                                                            <i className="fas fa-link mr-1"></i>
                                                            {budget.title}
                                                        </span>
                                                    ) : null;
                                                })()}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col">
                                                <span>{formatCurrency(exp.amount, exp.currencyCode, exp.transactionDate)}</span>
                                                {exp.currencyCode && exp.currencyCode !== 'USD' && exp.exchangeRate && exp.transactionDate && (
                                                    <ExchangeGainLossIndicator 
                                                        amount={exp.amount} 
                                                        currency={exp.currencyCode} 
                                                        exchangeRate={exp.exchangeRate}
                                                        transactionDate={exp.transactionDate}
                                                        size="sm"
                                                    />
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">{exp.dueDate || 'N/A'}</td>
                                         <td className="px-6 py-4">
                                            {exp.receipt ? (
                                                <div className="flex items-center space-x-3">
                                                     <button onClick={() => setViewingReceipt(exp.receipt!)} className="text-gray-500 hover:text-emerald-600" title={t('view_receipt')}><i className="fas fa-eye"></i></button>
                                                    <a href={exp.receipt.dataUrl} download={exp.receipt.fileName} className="text-gray-500 hover:text-emerald-600" title={t('download_receipt')}><i className="fas fa-download"></i></a>
                                                </div>
                                            ) : (<span className="text-gray-400 text-xs">{t('no_receipt_attached')}</span>)}
                                        </td>
                                        <td className="px-6 py-4 text-right space-x-2">
                                            {canManageEntity(exp.createdById) && (
                                                <>
                                            <button onClick={() => handleOpenExpenseModal(exp)} className="font-medium text-blue-600 hover:text-blue-800">{t('edit')}</button>
                                            <button onClick={() => setDeletingId({type: 'expense', id: exp.id})} className="font-medium text-red-600 hover:text-red-800">{t('delete')}</button>
                                                </>
                                            )}
                                        </td>
                                    </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        </div>
                            )}
                        </>
                    )}
                    {activeTab === 'recurring' && (
                        <div>
                             <div className="flex justify-between items-center mb-4">
                                <div className="p-1 bg-gray-200 rounded-lg">
                                    <button onClick={() => setActiveRecurringTab('invoices')} className={`px-3 py-1 text-sm font-semibold rounded-md ${activeRecurringTab === 'invoices' ? 'bg-white shadow' : 'text-gray-600'}`}>{t('recurring_invoices')}</button>
                                    <button onClick={() => setActiveRecurringTab('expenses')} className={`px-3 py-1 text-sm font-semibold rounded-md ${activeRecurringTab === 'expenses' ? 'bg-white shadow' : 'text-gray-600'}`}>{t('recurring_expenses')}</button>
                                </div>
                                {canManage && (
                                    <button onClick={activeRecurringTab === 'invoices' ? () => handleOpenInvoiceModal() : () => handleOpenExpenseModal()} className="bg-blue-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-700 flex items-center text-sm">
                                        <i className="fas fa-plus mr-2"></i>
                                        {activeRecurringTab === 'invoices' ? t('new_recurring_invoice') : t('new_recurring_expense')}
                                    </button>
                                )}
                            </div>
                            <div className="bg-white rounded-lg shadow-lg overflow-hidden">
                                {activeRecurringTab === 'invoices' && (
                                    <table className="w-full text-sm">
                                        <thead className="bg-gray-50 text-left text-xs text-gray-700 uppercase">
                                            <tr>
                                                <th className="px-6 py-3">{t('client_name')}</th><th className="px-6 py-3">{t('amount')}</th>
                                                <th className="px-6 py-3">{t('frequency')}</th><th className="px-6 py-3">{t('next_due_date')}</th>
                                                <th className="px-6 py-3 text-right">{t('actions')}</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y">
                                            {recurringInvoices.map(ri => (
                                                <tr key={ri.id} className="hover:bg-gray-50">
                                                <td className="px-6 py-4 font-medium">{ri.clientName}</td>
                                                <td className="px-6 py-4">
                                                    <div className="flex flex-col">
                                                        <span>{formatCurrency(ri.amount, ri.currencyCode, ri.startDate)}</span>
                                                        {ri.currencyCode && ri.currencyCode !== 'USD' && ri.exchangeRate && ri.startDate && (
                                                            <ExchangeGainLossIndicator 
                                                                amount={ri.amount} 
                                                                currency={ri.currencyCode} 
                                                                exchangeRate={ri.exchangeRate}
                                                                transactionDate={ri.startDate}
                                                                size="sm"
                                                            />
                                                        )}
                                                    </div>
                                                </td>
                                                    <td className="px-6 py-4">{t(ri.frequency.toLowerCase())}</td><td className="px-6 py-4">{getNextDueDate(ri)}</td>
                                                    <td className="px-6 py-4 text-right">
                                                        {canManageEntity(ri.createdById) && (
                                                            <button onClick={() => setDeletingId({type: 'recurringInvoice', id: ri.id})} className="font-medium text-red-600 hover:text-red-800">{t('delete')}</button>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                                {activeRecurringTab === 'expenses' && (
                                     <table className="w-full text-sm">
                                        <thead className="bg-gray-50 text-left text-xs text-gray-700 uppercase">
                                            <tr>
                                                <th className="px-6 py-3">{t('description')}</th><th className="px-6 py-3">{t('amount')}</th>
                                                <th className="px-6 py-3">{t('frequency')}</th><th className="px-6 py-3">{t('next_due_date')}</th>
                                                <th className="px-6 py-3 text-right">{t('actions')}</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y">
                                            {recurringExpenses.map(re => (
                                                <tr key={re.id} className="hover:bg-gray-50">
                                                <td className="px-6 py-4 font-medium">{re.description}</td>
                                                <td className="px-6 py-4">
                                                    <div className="flex flex-col">
                                                        <span>{formatCurrency(re.amount, re.currencyCode, re.startDate)}</span>
                                                        {re.currencyCode && re.currencyCode !== 'USD' && re.exchangeRate && re.startDate && (
                                                            <ExchangeGainLossIndicator 
                                                                amount={re.amount} 
                                                                currency={re.currencyCode} 
                                                                exchangeRate={re.exchangeRate}
                                                                transactionDate={re.startDate}
                                                                size="sm"
                                                            />
                                                        )}
                                                    </div>
                                                </td>
                                                    <td className="px-6 py-4">{t(re.frequency.toLowerCase())}</td><td className="px-6 py-4">{getNextDueDate(re)}</td>
                                                    <td className="px-6 py-4 text-right">
                                                        {canManageEntity(re.createdById) && (
                                                            <button onClick={() => setDeletingId({type: 'recurringExpense', id: re.id})} className="font-medium text-red-600 hover:text-red-800">{t('delete')}</button>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>
                    )}
                     {activeTab === 'budgets' && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {budgetsWithSpent.map(budget => {
                                const spent = budget.spentAmount;
                                const remaining = budget.amount - spent;
                                const progress = budget.amount > 0 ? (spent / budget.amount) * 100 : 0;
                                const project = budget.projectId ? projects.find(p => p.id === budget.projectId) : null;
                                return (
                                <div key={budget.id} className="bg-white p-6 rounded-xl shadow-lg flex flex-col justify-between">
                                    <div>
                                        <div className="flex justify-between items-start">
                                            <h3 className="font-bold text-lg text-gray-800">{budget.title}</h3>
                                            <span className={`text-xs font-semibold px-2 py-1 rounded-full ${budget.type === 'Project' ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'}`}>
                                                {t(budget.type === 'Project' ? 'project_budget' : 'office_management')}
                                            </span>
                                        </div>
                                        {project && <p className="text-xs text-gray-500 mt-1">Project: {project.title}</p>}
                                        <p className="text-sm text-gray-500 mt-2">{budget.startDate} to {budget.endDate}</p>

                                        <div className="mt-4">
                                            <div className="flex justify-between text-sm mb-1">
                                                <span className="text-gray-600">{t('amount_spent')}</span>
                                                <div className="flex flex-col">
                                                    <span className="font-semibold">{formatCurrency(spent, budget.currencyCode, budget.startDate)}</span>
                                                    {budget.currencyCode && budget.currencyCode !== 'USD' && budget.exchangeRate && budget.startDate && (
                                                        <ExchangeGainLossIndicator 
                                                            amount={budget.amount} 
                                                            currency={budget.currencyCode} 
                                                            exchangeRate={budget.exchangeRate}
                                                            transactionDate={budget.startDate}
                                                            size="sm"
                                                        />
                                                    )}
                                                </div>
                                            </div>
                                            <div className="w-full bg-gray-200 rounded-full h-4">
                                                <div 
                                                    className={`h-4 rounded-full ${progress > 100 ? 'bg-red-500' : 'bg-emerald-500'}`} 
                                                    style={{ width: `${Math.min(progress, 100)}%` }}
                                                ></div>
                                            </div>
                                             <div className="flex justify-between text-sm mt-1">
                                                <span className="text-gray-600">{t('remaining')}: <span className={remaining < 0 ? 'text-red-600 font-bold' : 'text-green-600'}>{formatCurrency(remaining, budget.currencyCode, budget.startDate)}</span></span>
                                                <div className="flex flex-col items-end">
                                                    <span className="font-bold text-gray-800">{formatCurrency(budget.amount, budget.currencyCode, budget.startDate)}</span>
                                                    {budget.currencyCode && budget.currencyCode !== 'USD' && budget.exchangeRate && budget.startDate && (
                                                        <ExchangeGainLossIndicator 
                                                            amount={budget.amount} 
                                                            currency={budget.currencyCode} 
                                                            exchangeRate={budget.exchangeRate}
                                                            transactionDate={budget.startDate}
                                                            size="sm"
                                                        />
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="mt-4 border-t pt-3 flex justify-end space-x-4">
                                        <button onClick={() => handleOpenBudgetDetailModal(budget)} className="text-sm font-semibold text-emerald-600 hover:text-emerald-800">{t('view_details')}</button>
                                        {canManageEntity(budget.createdById) && <>
                                            <button onClick={() => handleOpenBudgetModal(budget)} className="text-sm font-medium text-blue-600 hover:text-blue-800">{t('edit')}</button>
                                            <button onClick={() => setDeletingId({type: 'budget', id: budget.id})} className="text-sm font-medium text-red-600 hover:text-red-800">{t('delete')}</button>
                                        </>}
                                    </div>
                                </div>
                                )
                            })}
                        </div>
                    )}
                    {activeTab === 'analytics' && (
                        <FinanceAnalytics 
                            invoices={invoices}
                            expenses={expenses}
                            budgets={budgets}
                        />
                    )}
                </div>

            </div>
        </div>
        
        {isInvoiceModalOpen && <InvoiceFormModal invoice={editingInvoice} onClose={() => setInvoiceModalOpen(false)} onSave={handleSaveInvoice} onSaveRecurring={handleSaveRecurringInvoice} />}
        {isExpenseModalOpen && <ExpenseFormModal expense={editingExpense} budgets={budgets} expenses={expenses} onClose={() => setExpenseModalOpen(false)} onSave={handleSaveExpense} onSaveRecurring={handleSaveRecurringExpense} />}
        {isBudgetModalOpen && <BudgetFormModal budget={editingBudget} projects={projects} onClose={() => setBudgetModalOpen(false)} onSave={handleSaveBudget} />}
        {isBudgetDetailModalOpen && viewingBudget && (
            <BudgetDetailModal 
                budget={viewingBudget} 
                expenses={expenses} 
                onClose={() => setBudgetDetailModalOpen(false)} 
                onUpdateBudget={onUpdateBudget}
                formatCurrencyFn={formatCurrency}
            />
        )}
        {deletingId && <ConfirmationModal title={t('confirm_delete')} message={t('confirm_delete_message')} onConfirm={confirmDelete} onCancel={() => setDeletingId(null)} />}
        {viewingReceipt && <ReceiptViewerModal receipt={viewingReceipt} onClose={() => setViewingReceipt(null)} />}
    </>
    );
};

export default Finance;

