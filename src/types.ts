export type UserRole = 'admin' | 'accountant' | 'firm_user' | 'legal';

export interface UserProfile {
  id: string;
  email: string;
  role: UserRole;
  tenantId: string;
  name?: string;
  managedTenants?: string[];
}

export interface Tenant {
  id: string;
  name: string;
  oib: string;
  type: 'firm' | 'accountant';
  createdAt: any;
  accountantTenantId?: string;
  accountantId?: string;
  emailIngestionEnabled?: boolean;
  ingestionEmail?: string;
  erpFormat?: 'Pantheon' | 'Synesis' | 'Luwis' | 'Wand';
}

export interface TaxRate {
  rate: number;
  amount: number;
}

export interface InvoiceItem {
  id?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  coding?: string;
}

export interface RecognizedData {
  invoiceNumber?: string;
  date?: string;
  dueDate?: string;
  totalAmount?: number;
  currency?: string;
  taxRates?: TaxRate[];
  items?: InvoiceItem[];
  supplierName?: string;
  supplierOib?: string;
  supplierIban?: string;
  buyerName?: string;
  buyerOib?: string;
  paymentModel?: string;
  paymentReference?: string;
}

export interface AuditEntry {
  userId: string;
  userName: string;
  action: string;
  details: string;
  timestamp: any;
}

export interface Document {
  id: string;
  fileName: string;
  fileUrl?: string;
  status: 'pending' | 'processed' | 'approved' | 'rejected' | 'escalated';
  type: 'incoming_invoice' | 'outgoing_invoice';
  tenantId: string;
  uploadedBy: string;
  createdAt: any;
  recognizedData?: RecognizedData;
  paymentStatus?: 'unpaid' | 'partially_paid' | 'paid';
  auditLog?: AuditEntry[];
}
