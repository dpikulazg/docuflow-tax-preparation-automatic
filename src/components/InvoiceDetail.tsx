import React, { useState, useEffect } from 'react';
import { 
  X, 
  Plus, 
  Trash2, 
  CheckCircle2, 
  AlertTriangle, 
  History,
  Database,
  Calculator,
  FileText,
  Settings,
  CreditCard,
  ZoomIn,
  ZoomOut,
  Eye,
  FileCheck
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { ScrollArea } from './ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { Document, InvoiceItem, AuditEntry, UserProfile } from '../types';
import { format } from 'date-fns';
import { doc, updateDoc, arrayUnion, serverTimestamp, collection, addDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { toast } from 'sonner';

interface InvoiceDetailProps {
  document: Document;
  profile: UserProfile;
  onClose: () => void;
}

// Mock Master Data
const MOCK_PO_ITEMS = [
  { id: 'po_1', description: 'Uredski materijal - Papir', quantity: 10, unitPrice: 5.50, taxRate: 25 },
  { id: 'po_2', description: 'IT oprema - Miš', quantity: 5, unitPrice: 25.00, taxRate: 25 },
  { id: 'po_3', description: 'Usluge čišćenja', quantity: 1, unitPrice: 150.00, taxRate: 25 },
];

const TAGGABLE_FIELDS = [
  { id: 'supplierName', label: 'Dobavljač: Naziv', currentValueKey: 'supplierName' },
  { id: 'supplierOib', label: 'Dobavljač: OIB', currentValueKey: 'supplierOib' },
  { id: 'supplierIban', label: 'Dobavljač: IBAN', currentValueKey: 'supplierIban' },
  { id: 'invoiceNumber', label: 'Broj računa', currentValueKey: 'invoiceNumber' },
  { id: 'totalAmount', label: 'Ukupni iznos (EUR)', currentValueKey: 'totalAmount' },
  { id: 'buyerName', label: 'Kupac: Naziv', currentValueKey: 'buyerName' },
  { id: 'buyerOib', label: 'Kupac: OIB', currentValueKey: 'buyerOib' },
  { id: 'paymentModel', label: 'Model plaćanja', currentValueKey: 'paymentModel' },
  { id: 'paymentReference', label: 'Poziv na broj', currentValueKey: 'paymentReference' },
  { id: 'items', label: 'Stavke računa / line items', currentValueKey: 'items' },
];

export function InvoiceDetail({ document, profile, onClose }: InvoiceDetailProps) {
  const [data, setData] = useState(document.recognizedData || { items: [] });
  const [items, setItems] = useState<InvoiceItem[]>(document.recognizedData?.items || []);
  const [status, setStatus] = useState(document.status);
  const [paymentStatus, setPaymentStatus] = useState<Document['paymentStatus']>(document.paymentStatus || 'unpaid');
  const [isSaving, setIsSaving] = useState(false);

  // OCR Feedback State Variables
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [corrections, setCorrections] = useState<{ [key: string]: string }>({});
  const [feedbackComment, setFeedbackComment] = useState('');
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);

  // PDF / Document Viewer State Variables
  const [activeDocTab, setActiveDocTab] = useState<'original' | 'reconstruction'>(document.fileUrl ? 'original' : 'reconstruction');
  const [zoom, setZoom] = useState<number>(100);

  const subtotal = items.reduce((acc, item) => acc + (item.quantity * item.unitPrice), 0);
  
  const taxSummary = items.reduce((acc, item) => {
    const amount = (item.quantity * item.unitPrice) * (item.taxRate / 100);
    const existing = acc.find(t => t.rate === item.taxRate);
    if (existing) {
      existing.amount += amount;
      existing.base += (item.quantity * item.unitPrice);
    } else {
      acc.push({ rate: item.taxRate, amount, base: (item.quantity * item.unitPrice) });
    }
    return acc;
  }, [] as { rate: number, amount: number, base: number }[]).sort((a, b) => b.rate - a.rate);

  const totalTax = taxSummary.reduce((acc, t) => acc + t.amount, 0);
  const calculatedGrandTotal = subtotal + totalTax;
  const isBalanced = Math.abs(calculatedGrandTotal - (data.totalAmount || 0)) < 0.01;

  const logAudit = async (action: string, details: string) => {
    const entry: AuditEntry = {
      userId: profile.id,
      userName: profile.name || profile.email,
      action,
      details,
      timestamp: new Date()
    };
    
    const docRef = doc(db, 'documents', document.id);
    await updateDoc(docRef, {
      auditLog: arrayUnion(entry)
    });
  };

  const handleSaveHeader = async () => {
    setIsSaving(true);
    try {
      const docRef = doc(db, 'documents', document.id);
      await updateDoc(docRef, {
        'recognizedData.invoiceNumber': data.invoiceNumber,
        'recognizedData.supplierName': data.supplierName,
        'recognizedData.supplierOib': data.supplierOib,
        'recognizedData.supplierIban': data.supplierIban,
        'recognizedData.buyerName': data.buyerName,
        'recognizedData.buyerOib': data.buyerOib,
        'recognizedData.totalAmount': data.totalAmount,
        'recognizedData.paymentModel': data.paymentModel,
        'recognizedData.paymentReference': data.paymentReference,
        'paymentStatus': paymentStatus,
      });
      await logAudit('UPDATE_HEADER', `Izmijenjeni podaci zaglavlja i status plaćanja za račun ${data.invoiceNumber}`);
      toast.success('Zaglavlje spremljeno');
    } catch (e) {
      toast.error('Greška pri spremanju zaglavlja');
    }
    setIsSaving(false);
  };

  const handleUpdateItems = async (newItems: InvoiceItem[]) => {
    setItems(newItems);
    const docRef = doc(db, 'documents', document.id);
    await updateDoc(docRef, {
      'recognizedData.items': newItems
    });
  };

  const addItem = () => {
    const newItem: InvoiceItem = {
      description: 'Nova stavka',
      quantity: 1,
      unitPrice: 0,
      taxRate: 25,
    };
    handleUpdateItems([...items, newItem]);
    logAudit('ADD_ITEM', `Dodana nova stavka: ${newItem.description}`);
  };

  const removeItem = (index: number) => {
    const item = items[index];
    const filtered = items.filter((_, i) => i !== index);
    handleUpdateItems(filtered);
    logAudit('REMOVE_ITEM', `Uklonjena stavka: ${item?.description}`);
  };

  const updateItemField = (index: number, field: keyof InvoiceItem, value: any) => {
    const updated = items.map((item, i) => 
      i === index ? { ...item, [field]: value } : item
    );
    setItems(updated);
  };

  const saveItems = async () => {
    setIsSaving(true);
    await handleUpdateItems(items);
    await logAudit('UPDATE_ITEMS', 'Ažurirane stavke i kodiranje');
    toast.success('Stavke spremljene');
    setIsSaving(false);
  };

  const handleAction = async (newStatus: Document['status']) => {
    if (newStatus === 'approved' && !isBalanced) {
      toast.error('Ne može se odobriti: Iznosi stavki se ne podudaraju s ukupnim iznosom računa');
      return;
    }

    setIsSaving(true);
    try {
      const docRef = doc(db, 'documents', document.id);
      await updateDoc(docRef, { status: newStatus });
      setStatus(newStatus);
      await logAudit('STATUS_CHANGE', `Status promijenjen u ${newStatus}`);
      toast.success(`Račun ${newStatus}`);
      if (newStatus === 'approved' || newStatus === 'rejected') onClose();
    } catch (e) {
      toast.error('Akcija promjene statusa nije uspjela');
    }
    setIsSaving(false);
  };

  const addFromPO = (poItem: typeof MOCK_PO_ITEMS[0]) => {
    const newItem: InvoiceItem = {
      description: `[PO] ${poItem.description}`,
      quantity: poItem.quantity,
      unitPrice: poItem.unitPrice,
      taxRate: poItem.taxRate,
    };
    handleUpdateItems([...items, newItem]);
    logAudit('IMPORT_PO', `Uvezeno iz narudžbenice: ${poItem.description}`);
  };

  const handleSubmitFeedback = async () => {
    if (selectedFields.length === 0) {
      toast.error('Molimo odaberite barem jedno polje koje je netočno prepoznato.');
      return;
    }

    setIsSubmittingFeedback(true);
    const feedbackPath = `documents/${document.id}/ocrFeedback`;
    try {
      const feedbackData = {
        documentId: document.id,
        incorrectFields: selectedFields,
        corrections: corrections,
        comment: feedbackComment,
        submittedBy: profile.id,
        submittedByName: profile.name || profile.email,
        createdAt: serverTimestamp(),
      };

      await addDoc(collection(db, 'documents', document.id, 'ocrFeedback'), feedbackData);
      
      const fieldsListCro = selectedFields.map(f => {
        const found = TAGGABLE_FIELDS.find(tf => tf.id === f);
        return found ? found.label : f;
      }).join(', ');
      
      await logAudit('AI_FEEDBACK_SUBMITTED', `Prijavljene netočnosti za polja: ${fieldsListCro}`);
      
      toast.success('Hvala Vam na definiciji odabranog polja za prikaz podataka! Podaci su spremljeni u konfiguraciju sustava za prepoznavanje dokumenata.');
      
      setSelectedFields([]);
      setCorrections({});
      setFeedbackComment('');
      setShowFeedbackModal(false);
    } catch (error) {
      console.error('Greška pri slanju povratnih informacija:', error);
      toast.error('Nije uspjelo slanje povratnih informacija.');
      try {
        handleFirestoreError(error, OperationType.CREATE, feedbackPath);
      } catch (err) {
        // Suppress or handle re-thrown error
      }
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

  const isAccountant = profile.role === 'accountant' || profile.role === 'admin';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-[#E4E3E0] w-full max-w-[97vw] h-[94vh] border-2 border-black shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="p-6 border-b-2 border-black bg-white flex justify-between items-center shrink-0">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-black text-white">
              <FileText size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-bold uppercase tracking-tighter italic font-serif">Obrada Računa</h2>
              <p className="text-xs font-mono text-gray-500 uppercase tracking-widest">{document.fileName}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge className={`rounded-none px-4 py-1 uppercase font-bold text-xs ${
              status === 'approved' ? 'bg-green-500' : 
              status === 'rejected' ? 'bg-red-500' : 
              status === 'escalated' ? 'bg-orange-500' : 'bg-blue-500'
            }`}>
              {status}
            </Badge>
            <Button variant="ghost" onClick={onClose} className="hover:bg-black hover:text-white rounded-none">
              <X size={20} />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
          {/* PDF / Invoice Visual Verification Panel */}
          <div className="w-full lg:w-[42%] xl:w-[38%] border-r-2 border-black bg-[#E4E3E0]/40 flex flex-col overflow-hidden shrink-0">
            {/* Viewer Header / Toolbar Controls */}
            <div className="p-4 border-b-2 border-black bg-white flex justify-between items-center flex-wrap gap-2 shrink-0">
              <div className="flex items-center gap-2">
                <Button 
                  variant={activeDocTab === 'original' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setActiveDocTab('original')}
                  className={`rounded-none text-[10px] font-bold uppercase tracking-wider h-8 ${
                    activeDocTab === 'original' ? 'bg-black text-white' : 'border-black hover:bg-gray-100 bg-white text-black'
                  }`}
                  disabled={!document.fileUrl}
                >
                  <Eye size={12} className="mr-1" /> Izvornik {!document.fileUrl && "(Nema datoteke)"}
                </Button>
                <Button 
                  variant={activeDocTab === 'reconstruction' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setActiveDocTab('reconstruction')}
                  className={`rounded-none text-[10px] font-bold uppercase tracking-wider h-8 ${
                    activeDocTab === 'reconstruction' ? 'bg-black text-white' : 'border-black hover:bg-gray-100 bg-white text-black'
                  }`}
                >
                  <FileCheck size={12} className="mr-1" /> Vizualna rekonstrukcija
                </Button>
              </div>

              {/* Zoom Controls */}
              <div className="flex items-center gap-2">
                <Button 
                  variant="outline" 
                  size="icon" 
                  onClick={() => setZoom(prev => Math.max(50, prev - 10))}
                  className="w-7 h-7 border-black rounded-none bg-white text-black"
                >
                  <ZoomOut size={12} />
                </Button>
                <span className="text-[10px] font-mono font-bold w-10 text-center text-black">{zoom}%</span>
                <Button 
                  variant="outline" 
                  size="icon" 
                  onClick={() => setZoom(prev => Math.min(200, prev + 10))}
                  className="w-7 h-7 border-black rounded-none bg-white text-black"
                >
                  <ZoomIn size={12} />
                </Button>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setZoom(100)}
                  className="text-[9px] font-bold uppercase hover:bg-black hover:text-white rounded-none h-7 px-2 border border-black/10 text-stone-700 bg-white"
                >
                  Reset
                </Button>
              </div>
            </div>

            {/* Document display board */}
            <div className="flex-1 p-4 overflow-auto bg-stone-700/10 flex justify-center items-start select-none">
              <div 
                style={{ 
                  transform: `scale(${zoom / 100})`, 
                  transformOrigin: 'top center',
                  transition: 'transform 0.1s ease-out'
                }}
                className="w-full max-w-[500px] shrink-0"
              >
                {activeDocTab === 'original' && document.fileUrl ? (
                  /* Original document iframe or image block */
                  document.fileUrl.startsWith('data:application/pdf') || document.fileName.toLowerCase().endsWith('.pdf') ? (
                    <div className="w-full bg-white border-2 border-black p-1 aspect-[1/1.414]">
                      <iframe 
                        src={document.fileUrl} 
                        className="w-full h-full bg-white rounded-none border-none"
                        title="Original PDF Document"
                      />
                    </div>
                  ) : (
                    <div className="w-full bg-white border-2 border-black p-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                      <img 
                        src={document.fileUrl} 
                        alt="Scenirani original" 
                        className="w-full h-auto object-contain border border-black/10"
                      />
                    </div>
                  )
                ) : (
                  /* Reconstructed Croatian Invoice view. Pure absolute retro-classic layout. */
                  <div className="w-full bg-[#FCFBFA] border-2 border-black p-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] font-sans text-stone-800 text-left min-h-[640px] flex flex-col justify-between">
                    <div>
                      {/* Paper Header */}
                      <div className="flex justify-between items-start pb-4 border-b border-black">
                        <div className="space-y-1">
                          <p className="text-[10px] font-mono tracking-widest text-stone-400 uppercase leading-none">DOBAVLJAČ / SUPPLIER</p>
                          <h4 className="text-sm font-bold uppercase tracking-tight text-stone-900 leading-tight">
                            {data.supplierName || 'Nije definirano'}
                          </h4>
                          <p className="text-[9px] font-mono text-stone-500 leading-none">
                            OIB: <span className="font-bold">{data.supplierOib || 'Nije specificiran'}</span>
                          </p>
                          <p className="text-[9px] font-mono text-stone-500 leading-none">
                            IBAN: <span className="font-bold">{data.supplierIban || 'Nije specificiran'}</span>
                          </p>
                          <p className="text-[8px] italic text-stone-400">
                            Ulica kralja Tomislava 12, Zagreb, HR
                          </p>
                        </div>
                        <div className="text-right">
                          <span className="text-[9px] bg-stone-900 text-white px-2 py-0.5 font-bold tracking-widest uppercase">
                            ORIGINAL
                          </span>
                          <div className="pt-2">
                            <h3 className="text-xs font-bold leading-none font-mono text-stone-900">
                              {data.invoiceNumber ? `RAČUN br. ${data.invoiceNumber}` : 'Novi Račun'}
                            </h3>
                            <p className="text-[8px] font-mono text-stone-400 mt-1">
                              Datum: {document.createdAt?.toDate ? format(document.createdAt.toDate(), 'dd.MM.yyyy.') : 'Danas'}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Buyer Section */}
                      <div className="py-3 px-3 bg-stone-100 my-3 border border-stone-200">
                        <p className="text-[9px] font-mono tracking-widest text-stone-400 uppercase leading-none mb-1">KUPAC / BUYER</p>
                        <h5 className="text-xs font-bold text-stone-800 uppercase leading-normal">
                          {data.buyerName || 'Nije specificirano'}
                        </h5>
                        <p className="text-[9px] font-mono text-stone-600 leading-none">
                          OIB kupca: <span className="font-bold">{data.buyerOib || 'Nije specificiran'}</span>
                        </p>
                      </div>

                      {/* Line Items Table */}
                      <div className="my-4">
                        <table className="w-full text-[9px] border-collapse">
                          <thead>
                            <tr className="border-b border-stone-400 text-stone-500">
                              <th className="text-left py-1 font-bold">STAVKA / ITEM</th>
                              <th className="text-right py-1 font-bold w-10">KOL.</th>
                              <th className="text-right py-1 font-bold w-12 text-right">CIJENA</th>
                              <th className="text-right py-1 font-bold w-10 text-right">PDV</th>
                              <th className="text-right py-1 font-bold w-16 text-right">IZNOS</th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((item, idx) => (
                              <tr key={idx} className="border-b border-stone-100 text-stone-700">
                                <td className="py-1.5 align-top font-medium leading-tight">{item.description}</td>
                                <td className="py-1.5 align-top text-right font-mono">{item.quantity}</td>
                                <td className="py-1.5 align-top text-right font-mono">{item.unitPrice.toFixed(2)} €</td>
                                <td className="py-1.5 align-top text-right font-mono">{item.taxRate}%</td>
                                <td className="py-1.5 align-top text-right font-mono font-bold">
                                  {(item.quantity * item.unitPrice).toFixed(2)} €
                                </td>
                              </tr>
                            ))}
                            {items.length === 0 && (
                              <tr>
                                <td colSpan={5} className="py-6 text-center text-stone-400 italic">
                                  Nema unesenih stavki računa.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>

                      {/* Tax and Total Calculation breakdown inside document template */}
                      <div className="border-t border-stone-300 pt-2 flex justify-end">
                        <div className="w-56 space-y-1 text-[9px]">
                          <div className="flex justify-between">
                            <span className="text-stone-500">Iznos bez poreza (Neto):</span>
                            <span className="font-mono">{subtotal.toFixed(2)} €</span>
                          </div>
                          {taxSummary.map((tax, i) => (
                            <div key={i} className="flex justify-between text-stone-500">
                              <span>Porez PDV ({tax.rate}%):</span>
                              <span className="font-mono">+{tax.amount.toFixed(2)} €</span>
                            </div>
                          ))}
                          <div className="flex justify-between border-t border-stone-400 pt-1 text-[11px] font-bold text-stone-900">
                            <span>ZA PLATITI (Sveukupno):</span>
                            <span className="font-mono text-xs">{calculatedGrandTotal.toFixed(2)} €</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Standard Croatian RED HUB3 payment slip visual (uplatnica) mockup */}
                    <div className="mt-8 pt-4 border-t-2 border-dashed border-red-500/40 relative">
                      <div className="absolute top-1 left-0 right-0 flex justify-between text-[7px] text-red-500 font-mono tracking-widest leading-none">
                        <span>VIZUALIZACIJA NALOGA ZA PLAĆANJE (HUB3)</span>
                        <span>POSTA / RAČUN</span>
                      </div>
                      
                      <div className="bg-red-50/40 border border-red-200 p-2 mt-1 space-y-1.5 text-stone-800 rounded-none relative overflow-hidden">
                        <div className="absolute top-0 right-0 bottom-0 w-2.5 bg-red-400/20 flex items-center justify-center">
                          <div className="text-[6px] text-red-500 font-bold rotate-90 whitespace-nowrap leading-none tracking-widest origin-center">
                            NALOG ZA PLAĆANJE
                          </div>
                        </div>

                        {/* Top inputs strip */}
                        <div className="grid grid-cols-12 gap-1 text-[8px]">
                          <div className="col-span-8 space-y-1">
                            <div>
                              <span className="text-[6px] text-red-500 font-bold uppercase block leading-none">Platitelj (Naziv i adresa kupca)</span>
                              <div className="bg-white border border-red-300/60 px-1 py-0.5 font-bold text-[8px] truncate">
                                {data.buyerName || 'Nije unesen'}
                              </div>
                            </div>
                            <div>
                              <span className="text-[6px] text-red-500 font-bold uppercase block leading-none">Primatelj (Naziv i IBAN dobavljača)</span>
                              <div className="bg-white border border-red-300/60 px-1 py-0.5 font-bold text-[8px] truncate">
                                {data.supplierName || 'Nije unesen'}
                              </div>
                            </div>
                          </div>
                          <div className="col-span-4 space-y-1">
                            <div>
                              <span className="text-[6px] text-red-500 font-bold uppercase block leading-none">Valuta i Iznos (EUR)</span>
                              <div className="bg-white border border-red-450 px-1 py-0.5 font-mono text-[9px] font-bold text-stone-950 flex justify-between">
                                <span className="text-stone-400">EUR</span>
                                <span>{calculatedGrandTotal.toFixed(2)}</span>
                              </div>
                            </div>
                            <div>
                              <span className="text-[6px] text-red-500 font-bold uppercase block leading-none">IBAN Primatelja</span>
                              <div className="bg-white border border-red-450 px-1 py-0.5 font-mono text-[8px] font-bold truncate">
                                {data.supplierIban || 'Nije specificiran'}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Lower inputs strip */}
                        <div className="grid grid-cols-12 gap-1 text-[8px]">
                          <div className="col-span-4">
                            <span className="text-[6px] text-red-500 font-bold uppercase block leading-none">Model</span>
                            <div className="bg-white border border-red-300/60 px-1 py-0.5 font-mono text-[8px]">
                              {data.paymentModel || 'HR99'}
                            </div>
                          </div>
                          <div className="col-span-8">
                            <span className="text-[6px] text-red-500 font-bold uppercase block leading-none">Poziv na broj primatelja</span>
                            <div className="bg-white border border-red-400 px-1 py-0.5 font-mono text-[8px] font-bold truncate">
                              {data.paymentReference || 'Nije ispunjen'}
                            </div>
                          </div>
                        </div>

                        {/* Croatia 2D barcode payload simulation */}
                        <div className="flex justify-between items-center pt-1 border-t border-red-200/40">
                          <p className="text-[6px] italic text-stone-400">
                            Digitalizirano putem platforme DocuFlow.
                          </p>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[5px] font-bold text-red-500 font-mono">2D HUB BARCODE</span>
                            {/* Barcode graphic lines block */}
                            <div className="w-16 h-4 bg-stone-900 border border-stone-950 flex justify-around p-[1px] select-none">
                              <div className="w-[1px] h-full bg-white opacity-95"></div>
                              <div className="w-[2px] h-full bg-white opacity-95"></div>
                              <div className="w-[1px] h-full bg-white opacity-95"></div>
                              <div className="w-[3px] h-full bg-white opacity-95"></div>
                              <div className="w-[1px] h-full bg-white opacity-95"></div>
                              <div className="w-[2px] h-full bg-white opacity-95"></div>
                              <div className="w-[4px] h-full bg-white opacity-95"></div>
                              <div className="w-[1px] h-full bg-white opacity-95"></div>
                              <div className="w-[2px] h-full bg-white opacity-95"></div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            {/* Disclaimer / Warning Footer for Verification accuracy */}
            <div className="p-3 bg-stone-900 text-stone-400 border-t-2 border-stone-950 text-[9px] font-mono tracking-wide flex justify-between items-center select-none shrink-0">
              <span className="flex items-center gap-1.5 uppercase font-bold text-stone-300">
                <FileCheck size={11} className="text-green-500 animate-pulse" />
                Sustavni asistent spreman
              </span>
              <span className="uppercase font-bold text-stone-500">Obrada: AI v4.8</span>
            </div>
          </div>

          {/* Verification Form (Middle Column) */}
          <div className="flex-1 overflow-auto p-8 space-y-8 bg-stone-100/30">
            {/* Header Details */}
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
                  <Settings size={16} /> Podaci Zaglavlja
                </h3>
                <Button size="sm" onClick={handleSaveHeader} disabled={isSaving} className="bg-black text-white rounded-none text-[10px] uppercase font-bold">
                  Spremi Zaglavlje
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 bg-white p-6 border-2 border-black">
                {/* Supplier & Invoice Column */}
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-[10px] uppercase font-bold text-gray-500">Naziv Dobavljača</Label>
                      <Input 
                        value={data.supplierName || ''} 
                        onChange={(e) => setData({...data, supplierName: e.target.value})}
                        className="rounded-none border-black/20 focus:border-black text-xs font-bold"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[10px] uppercase font-bold text-gray-500">OIB Dobavljača</Label>
                      <Input 
                        value={data.supplierOib || ''} 
                        onChange={(e) => setData({...data, supplierOib: e.target.value})}
                        className="rounded-none border-black/20 focus:border-black text-xs font-bold"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[10px] uppercase font-bold text-gray-500">IBAN Dobavljača</Label>
                    <Input 
                      value={data.supplierIban || ''} 
                      onChange={(e) => setData({...data, supplierIban: e.target.value})}
                      className="rounded-none border-black/20 focus:border-black text-xs font-mono"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-[10px] uppercase font-bold text-gray-500">Broj Računa</Label>
                      <Input 
                        value={data.invoiceNumber || ''} 
                        onChange={(e) => setData({...data, invoiceNumber: e.target.value})}
                        className="rounded-none border-black/20 focus:border-black text-xs font-bold"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[10px] uppercase font-bold text-gray-500">Ukupni Iznos (EUR)</Label>
                      <Input 
                        type="number"
                        value={data.totalAmount || 0} 
                        onChange={(e) => setData({...data, totalAmount: parseFloat(e.target.value)})}
                        className="rounded-none border-black/20 focus:border-black text-xs font-bold"
                      />
                    </div>
                  </div>
                </div>

                {/* Buyer & Payment Column */}
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-[10px] uppercase font-bold text-gray-500">Naziv Kupca</Label>
                      <Input 
                        value={data.buyerName || ''} 
                        onChange={(e) => setData({...data, buyerName: e.target.value})}
                        className="rounded-none border-black/20 focus:border-black text-xs font-bold"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[10px] uppercase font-bold text-gray-500">OIB Kupca</Label>
                      <Input 
                        value={data.buyerOib || ''} 
                        onChange={(e) => setData({...data, buyerOib: e.target.value})}
                        className="rounded-none border-black/20 focus:border-black text-xs font-bold"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-[10px] uppercase font-bold text-gray-500">Model</Label>
                      <Input 
                        placeholder="HR01"
                        value={data.paymentModel || ''} 
                        onChange={(e) => setData({...data, paymentModel: e.target.value})}
                        className="rounded-none border-black/20 focus:border-black text-xs font-mono"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[10px] uppercase font-bold text-gray-500">Poziv na broj</Label>
                      <Input 
                        value={data.paymentReference || ''}                        
                        onChange={(e) => setData({...data, paymentReference: e.target.value})}
                        className="rounded-none border-black/20 focus:border-black text-xs font-mono"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[10px] uppercase font-bold text-gray-500">Status Plaćanja</Label>
                    <Select value={paymentStatus} onValueChange={(v: any) => setPaymentStatus(v)}>
                      <SelectTrigger className="rounded-none border-black/20 focus:border-black text-xs font-bold h-9 w-full bg-white">
                        <SelectValue placeholder="Odaberi status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unpaid">Neplaćeno</SelectItem>
                        <SelectItem value="partially_paid">Djelomično plaćeno</SelectItem>
                        <SelectItem value="paid">Plaćeno</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </section>

            {/* Line Items */}
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
                  <Calculator size={16} /> Stavke Računa i Izračun iznosa
                </h3>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={addItem} className="border-black rounded-none text-[10px] font-bold uppercase">
                    <Plus size={14} className="mr-1" /> Dodaj Red
                  </Button>
                  <Button size="sm" onClick={saveItems} disabled={isSaving} className="bg-black text-white rounded-none text-[10px] uppercase font-bold">
                    Spremi Stavke
                  </Button>
                </div>
              </div>
              
              <div className="bg-white border-2 border-black overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-[#F5F5F5] hover:bg-[#F5F5F5]">
                      <TableHead className="font-mono text-[10px] uppercase italic w-[300px]">Opis</TableHead>
                      <TableHead className="font-mono text-[10px] uppercase italic">Kol</TableHead>
                      <TableHead className="font-mono text-[10px] uppercase italic">Cijena</TableHead>
                      <TableHead className="font-mono text-[10px] uppercase italic">Porez %</TableHead>
                      <TableHead className="font-mono text-[10px] uppercase italic">Konto</TableHead>
                      <TableHead className="font-mono text-[10px] uppercase italic">Ukupno</TableHead>
                      <TableHead className="font-mono text-[10px] uppercase italic text-right"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item, index) => (
                      <TableRow key={index} className="hover:bg-gray-50">
                        <TableCell>
                          <Input 
                            value={item.description} 
                            onChange={(e) => updateItemField(index, 'description', e.target.value)}
                            className="h-8 rounded-none border-none focus:ring-1 focus:ring-black text-xs"
                          />
                        </TableCell>
                        <TableCell>
                          <Input 
                            type="number"
                            value={item.quantity} 
                            onChange={(e) => updateItemField(index, 'quantity', parseFloat(e.target.value))}
                            className="h-8 w-16 rounded-none border-none focus:ring-1 focus:ring-black text-xs"
                          />
                        </TableCell>
                        <TableCell>
                          <Input 
                            type="number"
                            value={item.unitPrice} 
                            onChange={(e) => updateItemField(index, 'unitPrice', parseFloat(e.target.value))}
                            className="h-8 w-24 rounded-none border-none focus:ring-1 focus:ring-black text-xs"
                          />
                        </TableCell>
                        <TableCell>
                          <Input 
                            type="number"
                            value={item.taxRate} 
                            onChange={(e) => updateItemField(index, 'taxRate', parseFloat(e.target.value))}
                            className="h-8 w-16 rounded-none border-none focus:ring-1 focus:ring-black text-xs"
                          />
                        </TableCell>
                        <TableCell>
                          <Input 
                            placeholder="Konto / Mjesto troška"
                            value={item.coding || ''} 
                            onChange={(e) => updateItemField(index, 'coding', e.target.value)}
                            className="h-8 rounded-none border-none focus:ring-1 focus:ring-black text-xs font-mono"
                          />
                        </TableCell>
                        <TableCell className="font-bold text-xs">
                          {(item.quantity * item.unitPrice).toFixed(2)} €
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" onClick={() => removeItem(index)} className="text-red-500 hover:bg-red-50 hover:text-red-600">
                            <Trash2 size={14} />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                
                <div className="p-4 bg-[#F5F5F5] border-t border-black space-y-4">
                  <div className="flex flex-col gap-2">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pb-4 border-b border-black/10">
                      <div className="space-y-1">
                        <span className="text-[10px] uppercase font-bold text-gray-500 block">Osnovica (Neto):</span>
                        <span className="text-sm font-bold">{subtotal.toFixed(2)} €</span>
                      </div>
                      <div className="space-y-1">
                        <span className="text-[10px] uppercase font-bold text-gray-500 block">Ukupni PDV:</span>
                        <span className="text-sm font-bold">{totalTax.toFixed(2)} €</span>
                      </div>
                      <div className="space-y-1">
                        <span className="text-[10px] uppercase font-bold text-gray-500 block">Izračunato (Bruto):</span>
                        <span className="text-sm font-bold text-blue-600">{calculatedGrandTotal.toFixed(2)} €</span>
                      </div>
                      <div className="space-y-1">
                        <span className="text-[10px] uppercase font-bold text-gray-500 block">Iznos na računu:</span>
                        <span className="text-sm font-bold">{data.totalAmount?.toFixed(2)} €</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-6 pt-2">
                      {taxSummary.map((tax, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <Badge variant="outline" className="rounded-none border-black/20 font-mono text-[9px] bg-white">
                            {tax.rate}% PDV
                          </Badge>
                          <div className="flex flex-col">
                            <span className="text-[9px] text-gray-400 uppercase font-bold leading-none">Porez</span>
                            <span className="text-[11px] font-bold">{tax.amount.toFixed(2)} €</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  
                  <div className="flex justify-between items-center pt-2">
                    <div className={`flex items-center gap-2 px-3 py-1 border ${
                      isBalanced ? 'bg-green-100 border-green-800 text-green-800' : 'bg-red-100 border-red-800 text-red-800'
                    }`}>
                      {isBalanced ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                      <span className="text-[10px] font-bold uppercase tracking-widest">
                        {isBalanced ? 'Balans ok' : 'Nije ok balans'}
                      </span>
                    </div>
                    {!isBalanced && (
                      <p className="text-[10px] font-bold text-red-600 uppercase animate-pulse">
                        Razlika: {Math.abs(calculatedGrandTotal - (data.totalAmount || 0)).toFixed(2)} €
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {/* Master Data Selection */}
            <section className="space-y-4">
              <h3 className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
                <Database size={16} /> Integracija Master Podataka (PO / Primke)
              </h3>
              <div className="grid grid-cols-3 gap-4">
                {MOCK_PO_ITEMS.map(po => (
                  <button 
                    key={po.id}
                    onClick={() => addFromPO(po)}
                    className="text-left p-4 border border-black/10 bg-white hover:border-black transition-all group"
                  >
                    <p className="text-[10px] font-bold uppercase text-gray-400 group-hover:text-black">Otvorena Narudžbenica</p>
                    <p className="text-xs font-bold truncate">{po.description}</p>
                    <p className="text-[10px] font-mono mt-1">{po.quantity} x {po.unitPrice} €</p>
                  </button>
                ))}
              </div>
            </section>
          </div>

          {/* Right Panel: Audit & Actions */}
          <aside className="w-80 border-l-2 border-black bg-white flex flex-col">
            <div className="p-6 border-b border-black bg-[#F5F5F5]">
              <h3 className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
                <History size={16} /> Audit Trail
              </h3>
            </div>
            <ScrollArea className="flex-1 p-6">
              <div className="space-y-6">
                {document.auditLog?.map((entry, i) => (
                  <div key={i} className="relative pl-4 border-l border-black/20 space-y-1">
                    <div className="absolute left-[-5px] top-0 w-2 h-2 rounded-full bg-black" />
                    <p className="text-[10px] font-bold uppercase tracking-tighter">{entry.action}</p>
                    <p className="text-[10px] text-gray-500">{entry.details}</p>
                    <div className="flex justify-between items-center pt-1">
                      <span className="text-[9px] font-mono text-gray-400">{entry.userName}</span>
                      <span className="text-[9px] font-mono text-gray-400">
                        {entry.timestamp?.toDate ? format(entry.timestamp.toDate(), 'HH:mm') : 'Sad'}
                      </span>
                    </div>
                  </div>
                ))}
                {!document.auditLog?.length && (
                  <p className="text-[10px] text-gray-400 italic text-center py-8">Nema zapisa u logovima</p>
                )}
              </div>
            </ScrollArea>

            <div className="p-6 border-t border-black space-y-3 bg-[#F5F5F5]">
              <Button 
                onClick={() => handleAction('approved')} 
                disabled={isSaving || !isBalanced}
                className="w-full bg-green-600 text-white hover:bg-green-700 rounded-none font-bold uppercase tracking-widest h-12"
              >
                Odobri Račun
              </Button>
              <div className="grid grid-cols-2 gap-3">
                <Button 
                  variant="outline" 
                  onClick={() => handleAction('rejected')} 
                  disabled={isSaving}
                  className="border-red-600 text-red-600 hover:bg-red-50 rounded-none font-bold uppercase tracking-widest text-[10px]"
                >
                  Odbij
                </Button>
                <Button 
                  variant="outline" 
                  onClick={() => handleAction('escalated')} 
                  disabled={isSaving}
                  className="border-orange-600 text-orange-600 hover:bg-orange-50 rounded-none font-bold uppercase tracking-widest text-[10px]"
                >
                  Eskaliraj
                </Button>
              </div>
              <Button 
                variant="outline" 
                onClick={() => setShowFeedbackModal(true)} 
                className="w-full border-dashed border-2 border-yellow-600/60 hover:border-yellow-600 text-yellow-800 rounded-none font-bold uppercase tracking-wider text-[10px] h-10 bg-yellow-50 hover:bg-yellow-100 flex items-center justify-center gap-2 mt-2"
              >
                <AlertTriangle size={14} className="text-yellow-600 animate-pulse" />
                Prijavi grešku u prepoznavanju dokumenata
              </Button>
            </div>
          </aside>
        </div>

        {/* OCR Feedback Modal */}
        <AnimatePresence>
          {showFeedbackModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4">
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="bg-[#E4E3E0] w-full max-w-xl max-h-[85vh] border-2 border-black shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] flex flex-col overflow-hidden text-left"
              >
                {/* Modal Header */}
                <div className="p-4 border-b-2 border-black bg-white flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="text-yellow-600" size={18} />
                    <h3 className="text-sm font-bold uppercase tracking-wider text-black">Prijava netočnosti prepoznavanja podataka</h3>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setShowFeedbackModal(false)} className="rounded-none hover:bg-black hover:text-white h-8 w-8 p-0 border border-transparent">
                    <X size={16} />
                  </Button>
                </div>

                {/* Modal Scroll Content */}
                <ScrollArea className="flex-1 p-6 space-y-4">
                  <div className="space-y-4 pr-3">
                    <p className="text-xs text-gray-700 font-medium leading-relaxed">
                      Označite polja na kojima je sustav za prepoznavanje napravio grešku prilikom obrade dokumenta. Vaša povratna informacija koristi se za strojno učenje i povećanje točnosti modela prepoznavanja polja podatka.
                    </p>

                    {/* Field Selector Toggles */}
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase font-bold text-gray-400 tracking-wider block">1. Označite netočno prepoznata polja:</label>
                      <div className="flex flex-wrap gap-2">
                        {TAGGABLE_FIELDS.map(field => {
                          const isSelected = selectedFields.includes(field.id);
                          return (
                            <button
                              key={field.id}
                              type="button"
                              onClick={() => {
                                if (isSelected) {
                                  setSelectedFields(selectedFields.filter(f => f !== field.id));
                                  const newCorrections = { ...corrections };
                                  delete newCorrections[field.id];
                                  setCorrections(newCorrections);
                                } else {
                                  setSelectedFields([...selectedFields, field.id]);
                                  const currentVal = field.currentValueKey === 'items' 
                                    ? `${items.length} stavki` 
                                    : (data as any)[field.currentValueKey]?.toString() || '';
                                  setCorrections({
                                    ...corrections,
                                    [field.id]: currentVal ? `Očekivano: (Sustav prepoznaje "${currentVal}") -> ` : ''
                                  });
                                }
                              }}
                              className={`px-3 py-1.5 border text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                                isSelected 
                                  ? 'bg-yellow-500 text-black border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] translate-x-[-1px] translate-y-[-1px]' 
                                  : 'bg-white hover:bg-gray-100 border-black/20 text-gray-700'
                              }`}
                            >
                              {isSelected && <CheckCircle2 size={12} />}
                              {field.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Corrections details list */}
                    {selectedFields.length > 0 && (
                      <div className="space-y-4 pt-4 border-t border-black/10">
                        <label className="text-[10px] uppercase font-bold text-gray-400 tracking-wider block">2. Točne vrijednosti / Opis grešaka:</label>
                        <div className="space-y-3">
                          {selectedFields.map(fieldId => {
                            const field = TAGGABLE_FIELDS.find(f => f.id === fieldId)!;
                            const currentVal = field.currentValueKey === 'items' 
                              ? `${items.length} stavki` 
                              : (data as any)[field.currentValueKey]?.toString() || 'Prazno';
                            return (
                              <div key={fieldId} className="bg-white p-3 border border-black/30 space-y-2">
                                <div className="flex justify-between items-center">
                                  <span className="text-xs font-bold text-black uppercase">{field.label}</span>
                                  <span className="text-[9px] font-mono text-gray-400">Prepoznat podatak: "{currentVal}"</span>
                                </div>
                                <Input 
                                  placeholder="Upišite ispravnu vrijednost ili razlog greške..."
                                  value={corrections[fieldId] || ''}
                                  onChange={(e) => setCorrections({
                                    ...corrections,
                                    [fieldId]: e.target.value
                                  })}
                                  className="h-8 rounded-none border-black/20 focus:border-black text-xs"
                                />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Common overall comment */}
                    <div className="space-y-2 pt-4 border-t border-black/10">
                      <label className="text-[10px] uppercase font-bold text-gray-400 tracking-wider block">3. Općeniti komentar ili napomena razvojnom timu:</label>
                      <textarea
                        placeholder="Upišite ako imate dodatnih informacija o grešci (npr. 'IBAN ne prepoznaje', 'loša kvaliteta prepoznavanja zbog slikanog dokumenta'...)"
                        value={feedbackComment}
                        onChange={(e) => setFeedbackComment(e.target.value)}
                        className="w-full h-16 p-2 text-xs bg-white border border-black/30 focus:border-black focus:outline-none focus:ring-1 focus:ring-black rounded-none min-h-[60px]"
                      />
                    </div>
                  </div>
                </ScrollArea>

                {/* Modal Footer Actions */}
                <div className="p-4 border-t-2 border-black bg-white flex justify-end gap-3 text-right">
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => setShowFeedbackModal(false)}
                    className="border-black rounded-none uppercase font-bold text-[10px] h-9"
                  >
                    Odustani
                  </Button>
                  <Button 
                    type="button" 
                    onClick={handleSubmitFeedback}
                    disabled={isSubmittingFeedback || selectedFields.length === 0}
                    className="bg-black text-white hover:bg-gray-800 rounded-none uppercase font-bold text-[10px] h-9 flex items-center gap-1.5"
                  >
                    {isSubmittingFeedback ? 'Slanje...' : 'Spremi i pošalji'}
                  </Button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
