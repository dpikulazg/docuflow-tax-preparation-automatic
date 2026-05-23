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
  CreditCard
} from 'lucide-react';
import { motion } from 'motion/react';
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
import { doc, updateDoc, arrayUnion, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
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

export function InvoiceDetail({ document, profile, onClose }: InvoiceDetailProps) {
  const [data, setData] = useState(document.recognizedData || { items: [] });
  const [items, setItems] = useState<InvoiceItem[]>(document.recognizedData?.items || []);
  const [status, setStatus] = useState(document.status);
  const [paymentStatus, setPaymentStatus] = useState<Document['paymentStatus']>(document.paymentStatus || 'unpaid');
  const [isSaving, setIsSaving] = useState(false);

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
      toast.error('Akcija nije uspjela');
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

  const isAccountant = profile.role === 'accountant' || profile.role === 'admin';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-[#E4E3E0] w-full max-w-6xl h-[90vh] border-2 border-black shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="p-6 border-b-2 border-black bg-white flex justify-between items-center">
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

        <div className="flex-1 overflow-hidden flex">
          {/* Left Panel: Form & Items */}
          <div className="flex-1 overflow-auto p-8 space-y-8">
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
                  <Calculator size={16} /> Stavke Računa & Kodiranje
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
                        {isBalanced ? 'Uravnoteženo' : 'Nije uravnoteženo'}
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
                  <p className="text-[10px] text-gray-400 italic text-center py-8">Nema zapisa u audit logu</p>
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
            </div>
          </aside>
        </div>
      </motion.div>
    </div>
  );
}
