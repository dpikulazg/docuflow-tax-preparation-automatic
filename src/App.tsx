import React, { useState, useEffect } from 'react';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  User
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  collection, 
  query, 
  where, 
  onSnapshot,
  orderBy,
  serverTimestamp
} from 'firebase/firestore';
import { auth, db } from './lib/firebase';
import { UserProfile, Tenant, Document } from './types';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { Badge } from './components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './components/ui/table';
import { Toaster } from './components/ui/sonner';
import { toast } from 'sonner';
import { 
  LayoutDashboard, 
  FileText, 
  Upload, 
  Users, 
  Settings, 
  LogOut, 
  Plus,
  Search,
  CheckCircle2,
  Clock,
  AlertCircle,
  Euro
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { useDropzone } from 'react-dropzone';
import { recognizeInvoice } from './lib/gemini';
import { InvoiceDetail } from './components/InvoiceDetail';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [clients, setClients] = useState<Tenant[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isUploading, setIsUploading] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        await fetchProfile(firebaseUser.uid);
      } else {
        setProfile(null);
        setTenant(null);
        setDocuments([]);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!profile?.tenantId) return;

    let q;
    if (profile.role === 'admin') {
      q = query(
        collection(db, 'documents'),
        orderBy('createdAt', 'desc')
      );
    } else if (profile.role === 'accountant') {
      // Accountants only see documents from tenants they manage
      // Or if they are assigned to the tenant specifically
      const managedIds = profile.managedTenants || [];
      const clientIds = [profile.tenantId, ...managedIds, ...clients.map(c => c.id)];
      
      if (clientIds.length > 0) {
        q = query(
          collection(db, 'documents'),
          where('tenantId', 'in', clientIds.slice(0, 30)),
          orderBy('createdAt', 'desc')
        );
      } else {
        setDocuments([]);
        return;
      }
    } else {
      q = query(
        collection(db, 'documents'),
        where('tenantId', '==', profile.tenantId),
        orderBy('createdAt', 'desc')
      );
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Document));
      setDocuments(docs);
    }, (error) => {
      console.error("Document subscription error:", error);
    });

    return unsubscribe;
  }, [profile, clients]);

  useEffect(() => {
    if (profile?.role === 'accountant' && profile.tenantId) {
      const q = query(
        collection(db, 'tenants'),
        where('accountantTenantId', '==', profile.tenantId)
      );
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const clientList = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Tenant));
        setClients(clientList);
      });
      return unsubscribe;
    }
  }, [profile]);

  const fetchProfile = async (uid: string) => {
    const docRef = doc(db, 'users', uid);
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      const profileData = docSnap.data() as UserProfile;
      setProfile({ ...profileData, id: uid });
      await fetchTenant(profileData.tenantId);
    } else {
      // New user setup - default to firm for demo
      const newTenantId = `tenant_${uid}`;
      const newTenant: Partial<Tenant> = {
        name: 'My Firm d.o.o.',
        oib: '12345678901',
        type: 'firm',
        createdAt: serverTimestamp()
      };
      
      const newProfile: Partial<UserProfile> = {
        email: auth.currentUser?.email || '',
        role: 'firm_user',
        tenantId: newTenantId,
        name: auth.currentUser?.displayName || ''
      };

      await setDoc(doc(db, 'tenants', newTenantId), newTenant);
      await setDoc(doc(db, 'users', uid), newProfile);
      
      setProfile({ ...newProfile, id: uid } as UserProfile);
      setTenant({ ...newTenant, id: newTenantId } as Tenant);
    }
  };

  const fetchTenant = async (tenantId: string) => {
    const docRef = doc(db, 'tenants', tenantId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      setTenant({ id: docSnap.id, ...docSnap.data() } as Tenant);
    }
  };

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Login failed', error);
      toast.error('Login failed');
    }
  };

  const handleLogout = () => signOut(auth);

  const onDrop = async (acceptedFiles: File[]) => {
    if (!profile || !tenant) return;
    
    setIsUploading(true);
    toast.info('Processing document with AI...');

    for (const file of acceptedFiles) {
      try {
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = (reader.result as string).split(',')[1];
          const recognized = await recognizeInvoice(base64, file.type);
          
          // Ensure items have IDs for editing
          if (recognized.items) {
            recognized.items = recognized.items.map((item: any) => ({
              ...item,
              id: item.id || Math.random().toString(36).substr(2, 9)
            }));
          }

          const docData: Partial<Document> = {
            fileName: file.name,
            fileUrl: reader.result as string,
            status: 'processed',
            type: 'incoming_invoice',
            tenantId: profile.tenantId,
            uploadedBy: profile.id,
            createdAt: serverTimestamp(),
            recognizedData: recognized,
            paymentStatus: 'unpaid'
          };

          const newDocRef = doc(collection(db, 'documents'));
          await setDoc(newDocRef, docData);
          toast.success(`Processed ${file.name}`);
        };
        reader.readAsDataURL(file);
      } catch (error) {
        console.error('OCR failed', error);
        toast.error(`Failed to process ${file.name}`);
      }
    }
    setIsUploading(false);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png'],
      'application/pdf': ['.pdf']
    }
  } as any);

  if (loading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-[#E4E3E0]">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-4 border-black border-t-transparent animate-spin" />
          <p className="font-mono text-sm uppercase tracking-widest">Inicijalizacija DocuFlow-a...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-[#E4E3E0] p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full text-center space-y-8"
        >
          <div className="space-y-2">
            <h1 className="text-6xl font-bold tracking-tighter uppercase italic font-serif">DocuFlow</h1>
            <p className="text-sm font-mono text-gray-500 uppercase tracking-widest">Hrvatska platforma za upravljanje dokumentima</p>
          </div>
          
          <Card className="border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] rounded-none">
            <CardHeader>
              <CardTitle className="text-2xl font-bold uppercase tracking-tight">Dobrodošli natrag</CardTitle>
              <CardDescription>Prijavite se za upravljanje dokumentima i računovodstvenim workflow-om.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                onClick={handleLogin}
                className="w-full h-12 bg-black text-white hover:bg-gray-800 rounded-none font-bold uppercase tracking-wide transition-all active:translate-x-1 active:translate-y-1 active:shadow-none"
              >
                Prijava putem Google-a
              </Button>
            </CardContent>
          </Card>
          
          <div className="grid grid-cols-2 gap-4 text-left">
            <div className="p-4 border border-black/10 rounded-lg bg-white/50">
              <h3 className="font-bold text-xs uppercase mb-1">Za Tvrtke</h3>
              <p className="text-xs text-gray-600">Automatsko slanje računa i real-time podaci o ulazu robe i provjera plaćanja.</p>
            </div>
            <div className="p-4 border border-black/10 rounded-lg bg-white/50">
              <h3 className="font-bold text-xs uppercase mb-1">Za Računovodstveni ured</h3>
              <p className="text-xs text-gray-600">Standardizirani željeni export podataka kroz API endpoint URL te prepoznavanje dokumenata.</p>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  const isAccountant = profile?.role === 'accountant' || profile?.role === 'admin';
  const themeClass = isAccountant ? 'accountant-theme' : 'firm-theme';

  return (
    <div className={`min-h-screen flex font-sans text-[#141414] ${isAccountant ? 'bg-[#E4E3E0]' : 'bg-[#F8F9FA]'}`}>
      <Toaster position="top-right" />
      
      {selectedDoc && profile && (
        <InvoiceDetail 
          document={selectedDoc} 
          profile={profile} 
          onClose={() => setSelectedDoc(null)} 
        />
      )}
      {/* Sidebar */}
      <aside className={`w-64 border-r border-black flex flex-col ${isAccountant ? 'bg-white' : 'bg-[#1A1A1A] text-white'}`}>
        <div className={`p-6 border-b border-black ${!isAccountant && 'border-white/10'}`}>
          <h2 className={`text-2xl font-bold tracking-tighter uppercase italic font-serif ${!isAccountant && 'text-white'}`}>DocuFlow</h2>
          <p className={`text-[10px] font-mono uppercase tracking-widest mt-1 ${isAccountant ? 'text-gray-500' : 'text-gray-400'}`}>{tenant?.name}</p>
        </div>
        
        <nav className="flex-1 p-4 space-y-2">
          <SidebarItem 
            icon={<LayoutDashboard size={18} />} 
            label="Dashboard" 
            active={activeTab === 'dashboard'} 
            onClick={() => setActiveTab('dashboard')} 
            isAccountant={isAccountant}
          />
          <SidebarItem 
            icon={<FileText size={18} />} 
            label="Arhiva" 
            active={activeTab === 'documents'} 
            onClick={() => setActiveTab('documents')} 
            isAccountant={isAccountant}
          />
          {isAccountant && (
            <SidebarItem 
              icon={<Users size={18} />} 
              label="Klijenti" 
              active={activeTab === 'clients'} 
              onClick={() => setActiveTab('clients')} 
              isAccountant={isAccountant}
            />
          )}
          {profile?.role !== 'legal' && (
            <SidebarItem 
              icon={<Upload size={18} />} 
              label="Upload" 
              active={activeTab === 'upload'} 
              onClick={() => setActiveTab('upload')} 
              isAccountant={isAccountant}
            />
          )}
          <SidebarItem 
            icon={<Settings size={18} />} 
            label="Postavke" 
            active={activeTab === 'settings'} 
            onClick={() => setActiveTab('settings')} 
            isAccountant={isAccountant}
          />
        </nav>
        
        <div className={`p-4 border-t border-black ${!isAccountant && 'border-white/10'}`}>
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${isAccountant ? 'bg-black text-white' : 'bg-white text-black'}`}>
              {user.displayName?.[0]}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold truncate">{user.displayName}</p>
              <p className={`text-[10px] truncate uppercase tracking-tighter ${isAccountant ? 'text-gray-500' : 'text-gray-400'}`}>{profile?.role}</p>
            </div>
          </div>
          <Button 
            variant="outline" 
            onClick={handleLogout}
            style={{ backgroundColor: '#380052' }}
            className="w-full justify-start gap-2 rounded-none transition-colors text-white border-none hover:opacity-90"
          >
            <LogOut size={16} />
            <span className="text-xs font-bold uppercase tracking-wider">Odjava</span>
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <header className={`h-16 border-b flex items-center justify-between px-8 ${isAccountant ? 'bg-white border-black' : 'bg-white border-gray-200 shadow-sm'}`}>
          <div className="flex items-center gap-4">
            <h3 className="font-bold uppercase tracking-tight text-sm">{activeTab === 'dashboard' ? 'Pregled' : activeTab}</h3>
            <div className="h-4 w-[1px] bg-black/20" />
            <div className="flex items-center gap-2 text-xs text-gray-500 font-mono">
              <Clock size={14} />
              {format(new Date(), 'EEEE, dd.MM.yyyy')}
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
              <input 
                type="text" 
                placeholder="Pretraži dokumente..." 
                className={`pl-9 pr-4 py-2 border rounded-none text-xs focus:outline-none transition-colors w-64 ${isAccountant ? 'bg-[#F5F5F5] border-black/10 focus:border-black' : 'bg-white border-gray-200 focus:ring-2 focus:ring-black/5'}`}
              />
            </div>
            <Button size="sm" className={`rounded-none uppercase text-[10px] font-bold tracking-widest px-4 ${isAccountant ? 'bg-black text-white' : 'bg-[#1A1A1A] hover:bg-black'}`}>
              <Plus size={14} className="mr-1" /> Novi Unos
            </Button>
          </div>
        </header>

        <div className="p-8">
          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' && (
              <motion.div 
                key="dashboard"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-8"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <StatCard 
                    title="Ukupno Dokumenata" 
                    value={documents.length.toString()} 
                    trend="+12% od prošlog mjeseca"
                    icon={<FileText className="text-blue-500" />}
                    isAccountant={isAccountant}
                  />
                  <StatCard 
                    title="Čeka Odobrenje" 
                    value={documents.filter(d => d.status === 'pending').length.toString()} 
                    trend="Potrebna akcija"
                    icon={<Clock className="text-orange-500" />}
                    isAccountant={isAccountant}
                  />
                  <StatCard 
                    title="Ukupno EUR (Neplaćeno)" 
                    value={documents.filter(d => d.paymentStatus === 'unpaid').reduce((acc, d) => acc + (d.recognizedData?.totalAmount || 0), 0).toFixed(2)} 
                    trend="Projected cashflow"
                    icon={<Euro className="text-green-500" />}
                    isAccountant={isAccountant}
                  />
                  <StatCard 
                    title="Obrađeno (AI)" 
                    value={documents.filter(d => d.status === 'processed').length.toString()} 
                    trend="98% točnost"
                    icon={<CheckCircle2 className="text-purple-500" />}
                    isAccountant={isAccountant}
                  />
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                  <Card className={`xl:col-span-2 rounded-none ${isAccountant ? 'border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]' : 'border-none shadow-xl'}`}>
                    <CardHeader className={isAccountant ? 'border-b border-black' : 'pb-2'}>
                      <CardTitle className={`text-lg font-bold uppercase ${isAccountant ? 'italic font-serif' : 'tracking-tight'}`}>Zadnji Dokumenti</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <Table>
                        <TableHeader>
                          <TableRow className={`${isAccountant ? 'bg-[#F5F5F5]' : 'bg-gray-50'} hover:bg-transparent`}>
                            <TableHead className="font-mono text-[10px] uppercase italic">Naziv datoteke</TableHead>
                            <TableHead className="font-mono text-[10px] uppercase italic">Status</TableHead>
                            <TableHead className="font-mono text-[10px] uppercase italic">Iznos</TableHead>
                            <TableHead className="font-mono text-[10px] uppercase italic">Datum</TableHead>
                            <TableHead className="font-mono text-[10px] uppercase italic text-right">Akcija</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {documents.slice(0, 5).map((doc) => (
                            <TableRow 
                              key={doc.id} 
                              onClick={() => setSelectedDoc(doc)}
                              className={`transition-colors cursor-pointer group ${isAccountant ? 'hover:bg-black hover:text-white' : 'hover:bg-gray-50'}`}
                            >
                              <TableCell className="font-bold text-xs">{doc.fileName}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className={`rounded-none text-[9px] uppercase font-bold ${
                                  doc.status === 'processed' ? 'bg-green-100 text-green-800 border-green-800' : 
                                  doc.status === 'pending' ? 'bg-orange-100 text-orange-800 border-orange-800' : 'bg-gray-100'
                                }`}>
                                  {doc.status}
                                </Badge>
                              </TableCell>
                              <TableCell className="font-mono text-xs">
                                {doc.recognizedData?.totalAmount?.toFixed(2)} {doc.recognizedData?.currency || 'EUR'}
                              </TableCell>
                              <TableCell className={`text-xs ${isAccountant ? 'text-gray-500 group-hover:text-gray-300' : 'text-gray-400'}`}>
                                {doc.createdAt?.toDate ? format(doc.createdAt.toDate(), 'dd.MM.yyyy') : 'Upravo sad'}
                              </TableCell>
                              <TableCell className="text-right">
                                <Button variant="ghost" size="sm" className={`h-8 w-8 p-0 ${isAccountant ? 'group-hover:text-white' : 'text-gray-400'}`}>
                                  <Search size={14} />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>

                  <Card className={`rounded-none ${isAccountant ? 'border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]' : 'border-none shadow-xl'}`}>
                    <CardHeader className={isAccountant ? 'border-b border-black' : 'pb-2'}>
                      <CardTitle className={`text-lg font-bold uppercase ${isAccountant ? 'italic font-serif' : 'tracking-tight'}`}>Porezni Sažetak (EUR)</CardTitle>
                    </CardHeader>
                    <CardContent className="p-6 space-y-4">
                      <TaxRow label="PDV 25%" amount={1240.50} />
                      <TaxRow label="PDV 13%" amount={450.20} />
                      <TaxRow label="PDV 5%" amount={120.00} />
                      <div className={`pt-4 border-t ${isAccountant ? 'border-black/10' : 'border-gray-100'}`}>
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-bold uppercase">Ukupno PDV</span>
                          <span className="text-lg font-bold">1,810.70 €</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </motion.div>
            )}

            {activeTab === 'upload' && (
              <motion.div 
                key="upload"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="max-w-2xl mx-auto"
              >
                <Card className="border-2 border-dashed border-black rounded-none bg-white/50 p-12 text-center">
                  <div {...getRootProps()} className="cursor-pointer space-y-6">
                    <input {...getInputProps()} />
                    <div className="w-20 h-20 bg-black text-white rounded-full flex items-center justify-center mx-auto shadow-[4px_4px_0px_0px_rgba(0,0,0,0.2)]">
                      <Upload size={32} />
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-2xl font-bold uppercase tracking-tight">Drop your invoices here</h3>
                      <p className="text-sm text-gray-500 max-w-xs mx-auto">
                        PDF, PNG, or JPEG. Our AI will automatically extract OIB, amounts, and tax rates.
                      </p>
                    </div>
                    {isDragActive ? (
                      <p className="text-blue-600 font-bold uppercase text-xs animate-pulse">Drop it now!</p>
                    ) : (
                      <Button variant="outline" className="border-black rounded-none uppercase text-xs font-bold tracking-widest px-8">
                        Select Files
                      </Button>
                    )}
                  </div>
                </Card>
                
                {isUploading && (
                  <div className="mt-8 p-6 border-2 border-black bg-white flex items-center gap-4">
                    <div className="w-6 h-6 border-2 border-black border-t-transparent animate-spin rounded-full" />
                    <p className="text-sm font-bold uppercase tracking-tight">AI is analyzing your documents...</p>
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === 'documents' && (
              <motion.div 
                key="documents"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-6"
              >
                <div className="flex justify-between items-end">
                  <div className="space-y-1">
                    <h2 className="text-3xl font-bold uppercase tracking-tighter">Arhiva Dokumenata</h2>
                    <p className="text-xs text-gray-500 font-mono uppercase tracking-widest">
                      {profile?.role === 'admin' ? 'Svi Dokumneti' : 
                       profile?.role === 'accountant' ? 'Portfolio Dokumenti' : 
                       `Dokumenti za ${tenant?.name}`}
                    </p>
                  </div>
                  <Tabs defaultValue="all" className="w-[400px]">
                    <TabsList className="grid w-full grid-cols-3 rounded-none border-2 border-black bg-white p-1">
                      <TabsTrigger value="all" className="rounded-none data-[state=active]:bg-black data-[state=active]:text-white uppercase text-[10px] font-bold">Svi</TabsTrigger>
                      <TabsTrigger value="unpaid" className="rounded-none data-[state=active]:bg-black data-[state=active]:text-white uppercase text-[10px] font-bold">Neplaćeni</TabsTrigger>
                      <TabsTrigger value="paid" className="rounded-none data-[state=active]:bg-black data-[state=active]:text-white uppercase text-[10px] font-bold">Plaćeni</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>

                <Card className="border-2 border-black rounded-none shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-[#F5F5F5] hover:bg-[#F5F5F5]">
                        <TableHead className="font-mono text-[10px] uppercase italic">ID</TableHead>
                        {(profile?.role === 'admin' || profile?.role === 'accountant') && (
                          <TableHead className="font-mono text-[10px] uppercase italic">Korisnik</TableHead>
                        )}
                        <TableHead className="font-mono text-[10px] uppercase italic">Rsačun #</TableHead>
                        <TableHead className="font-mono text-[10px] uppercase italic">Datum</TableHead>
                        <TableHead className="font-mono text-[10px] uppercase italic">Iznost</TableHead>
                        <TableHead className="font-mono text-[10px] uppercase italic">PDV</TableHead>
                        <TableHead className="font-mono text-[10px] uppercase italic">Status</TableHead>
                        <TableHead className="font-mono text-[10px] uppercase italic text-right">Akcija</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {documents.map((doc) => (
                        <TableRow 
                          key={doc.id} 
                          onClick={() => setSelectedDoc(doc)}
                          className="hover:bg-[#F9F9F9] transition-colors cursor-pointer"
                        >
                          <TableCell className="font-mono text-[10px] text-gray-400">#{doc.id.slice(0, 6)}</TableCell>
                          {(profile?.role === 'admin' || profile?.role === 'accountant') && (
                            <TableCell className="text-[10px] font-bold uppercase">
                              {clients.find(c => c.id === doc.tenantId)?.name || (doc.tenantId === profile?.tenantId ? 'Self' : 'Unknown')}
                            </TableCell>
                          )}
                          <TableCell className="font-bold text-xs">{doc.recognizedData?.invoiceNumber || 'N/A'}</TableCell>
                          <TableCell className="text-xs">{doc.recognizedData?.date || 'N/A'}</TableCell>
                          <TableCell className="font-mono text-xs font-bold">{doc.recognizedData?.totalAmount?.toFixed(2)} €</TableCell>
                          <TableCell className="text-[10px] text-gray-500">
                            {doc.recognizedData?.taxRates?.map(tr => `${tr.rate}%`).join(', ') || '0%'}
                          </TableCell>
                          <TableCell>
                            <Badge className={`rounded-none text-[9px] uppercase font-bold ${
                              doc.paymentStatus === 'paid' ? 'bg-green-500' : 'bg-red-500'
                            }`}>
                              {doc.paymentStatus}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button variant="outline" size="sm" className="h-7 text-[10px] uppercase font-bold border-black rounded-none">Pregle</Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              </motion.div>
            )}

            {activeTab === 'clients' && (profile?.role === 'accountant' || profile?.role === 'admin') && (
              <motion.div 
                key="clients"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-6"
              >
                <div className="flex justify-between items-end">
                  <div className="space-y-1">
                    <h2 className="text-3xl font-bold uppercase tracking-tighter">Portfolio Klijenata</h2>
                    <p className="text-xs text-gray-500 font-mono uppercase tracking-widest">Tvrtke kojima upravlja vaš ured</p>
                  </div>
                  <Button className="bg-black text-white rounded-none uppercase text-xs font-bold tracking-widest">
                    <Plus size={16} className="mr-2" /> Dodaj Klijenta
                  </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {clients.map((client) => (
                    <Card key={client.id} className="border-2 border-black rounded-none shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] bg-white hover:translate-x-1 hover:translate-y-1 hover:shadow-none transition-all cursor-pointer">
                      <CardHeader className="border-b border-black bg-[#F5F5F5]">
                        <CardTitle className="text-sm font-bold uppercase">{client.name}</CardTitle>
                        <CardDescription className="text-[10px] font-mono">OIB: {client.oib}</CardDescription>
                      </CardHeader>
                      <CardContent className="p-4 space-y-4">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] uppercase font-bold text-gray-500">Dokumenti</span>
                          <span className="text-xs font-bold">{documents.filter(d => d.tenantId === client.id).length}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] uppercase font-bold text-gray-500">Na čekanju</span>
                          <span className="text-xs font-bold text-orange-600">
                            {documents.filter(d => d.tenantId === client.id && d.status === 'pending').length}
                          </span>
                        </div>
                        <Button 
                          variant="outline" 
                          className="w-full border-black rounded-none text-[10px] font-bold uppercase"
                          onClick={() => {
                            setActiveTab('documents');
                          }}
                        >
                          Pregledaj Dokumente
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                  {clients.length === 0 && (
                    <div className="col-span-full p-12 border-2 border-dashed border-black text-center">
                      <p className="text-sm font-bold uppercase text-gray-400 italic">Nema klijenata u portfelju</p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {activeTab === 'settings' && (
              <motion.div 
                key="settings"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="max-w-4xl space-y-8"
              >
                <div className="space-y-1">
                  <h2 className="text-3xl font-bold uppercase tracking-tighter">Postavke Sustava</h2>
                  <p className="text-xs text-gray-500 font-mono uppercase tracking-widest">Konfiguracija profila i postavke za integraciju</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Profile Settings */}
                  <Card className={`rounded-none ${isAccountant ? 'border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]' : 'border-none shadow-xl'}`}>
                    <CardHeader className={isAccountant ? 'border-b border-black' : ''}>
                      <CardTitle className="text-lg font-bold uppercase">Profil Korisnika</CardTitle>
                    </CardHeader>
                    <CardContent className="p-6 space-y-4">
                      <div className="space-y-2">
                        <Label className="text-[10px] uppercase font-bold text-gray-500">Ime i Prezime</Label>
                        <Input value={profile?.name || ''} readOnly className="rounded-none border-black/10 bg-gray-50" />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-[10px] uppercase font-bold text-gray-500">Email Adresa</Label>
                        <Input value={profile?.email || ''} readOnly className="rounded-none border-black/10 bg-gray-50" />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-[10px] uppercase font-bold text-gray-500">Uloga u sustavu</Label>
                        <Badge className="rounded-none uppercase font-bold">{profile?.role}</Badge>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Tenant Settings */}
                  <Card className={`rounded-none ${isAccountant ? 'border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]' : 'border-none shadow-xl'}`}>
                    <CardHeader className={isAccountant ? 'border-b border-black' : ''}>
                      <CardTitle className="text-lg font-bold uppercase">Podaci o Tvrtki</CardTitle>
                    </CardHeader>
                    <CardContent className="p-6 space-y-4">
                      <div className="space-y-2">
                        <Label className="text-[10px] uppercase font-bold text-gray-500">Naziv Subjekta</Label>
                        <Input value={tenant?.name || ''} readOnly className="rounded-none border-black/10 bg-gray-50" />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-[10px] uppercase font-bold text-gray-500">OIB</Label>
                        <Input value={tenant?.oib || ''} readOnly className="rounded-none border-black/10 bg-gray-50" />
                      </div>
                      {tenant?.type === 'firm' && (
                        <div className="p-3 bg-blue-50 border border-blue-200 text-[10px] text-blue-800 uppercase font-bold">
                          Vaše dokumente obrađuje: {isAccountant ? 'Vlastiti ured' : 'Vanjski knjigovodstveni servis'}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Accountant Specific Settings */}
                  {profile?.role === 'accountant' && (
                    <Card className="col-span-full border-2 border-black rounded-none shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] bg-white">
                      <CardHeader className="border-b border-black">
                        <CardTitle className="text-lg font-bold uppercase italic font-serif">Postavke Knjigovodstvenog ureda</CardTitle>
                      </CardHeader>
                      <CardContent className="p-6 space-y-6">
                        <div className="grid grid-cols-2 gap-8">
                          <div className="space-y-4">
                            <Label className="text-[10px] uppercase font-bold text-gray-500">ERP Sustav za integraciju</Label>
                            <Select defaultValue={tenant?.erpFormat || 'Pantheon'}>
                              <SelectTrigger className="rounded-none border-black">
                                <SelectValue placeholder="Odaberi ERP" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Pantheon">Pantheon (.xml)</SelectItem>
                                <SelectItem value="Synesis">Synesis (.txt)</SelectItem>
                                <SelectItem value="Luwis">Luwis (.csv)</SelectItem>
                                <SelectItem value="Wand">4D Wand (.xml)</SelectItem>
                              </SelectContent>
                            </Select>
                            <p className="text-[10px] text-gray-400 italic">Ovaj format će se koristiti za generiranje batch datoteka za odabrani ERP sustav.</p>
                          </div>
                          <div className="space-y-4">
                            <Label className="text-[10px] uppercase font-bold text-gray-500">Email Ingestion Obrada</Label>
                            <div className="flex items-center gap-4">
                              <div className={`p-2 border border-black font-mono text-xs ${tenant?.emailIngestionEnabled ? 'bg-green-50' : 'bg-gray-50 text-gray-400'}`}>
                                {tenant?.ingestionEmail || 'nije-definirano@docuflow.hr'}
                              </div>
                              <Badge className={`rounded-none ${tenant?.emailIngestionEnabled ? 'bg-green-600' : 'bg-gray-400'}`}>
                                {tenant?.emailIngestionEnabled ? 'AKTIVNO' : 'NEAKTIVNO'}
                              </Badge>
                            </div>
                            <p className="text-[10px] text-gray-400 italic">Klijenti mogu slati dokumente direktno na ovu email adresu.</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Admin Specific Settings */}
                  {profile?.role === 'admin' && (
                    <Card className="col-span-full border-2 border-black rounded-none shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] bg-white">
                      <CardHeader className="border-b border-black">
                        <CardTitle className="text-lg font-bold uppercase italic font-serif">Administracija Sustava</CardTitle>
                      </CardHeader>
                      <CardContent className="p-6">
                        <Button className="bg-black text-white rounded-none uppercase text-xs font-bold">
                          Upravljanje Svim Korisnicima
                        </Button>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

function SidebarItem({ icon, label, active, onClick, isAccountant }: { icon: React.ReactNode, label: string, active?: boolean, onClick: () => void, isAccountant: boolean }) {
  return (
    <button 
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-bold uppercase tracking-widest transition-all ${
        active 
          ? (isAccountant ? 'bg-black text-white shadow-[4px_4px_0px_0px_rgba(0,0,0,0.2)]' : 'bg-white text-black shadow-lg')
          : (isAccountant ? 'text-gray-500 hover:text-black hover:bg-gray-100' : 'text-gray-400 hover:text-white hover:bg-white/5')
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function StatCard({ title, value, trend, icon, isAccountant }: { title: string, value: string, trend: string, icon: React.ReactNode, isAccountant: boolean }) {
  return (
    <Card className={`rounded-none ${isAccountant ? 'border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] bg-white' : 'border-none shadow-lg bg-white'}`}>
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className={`text-[10px] font-mono uppercase tracking-widest italic ${isAccountant ? 'text-gray-500' : 'text-gray-400'}`}>{title}</CardTitle>
        <div className={`w-8 h-8 flex items-center justify-center ${isAccountant ? 'bg-[#F5F5F5] border border-black/10' : 'bg-gray-50 rounded-full'}`}>
          {icon}
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold tracking-tighter">{value}</div>
        <p className="text-[9px] font-mono text-gray-400 uppercase mt-1">{trend}</p>
      </CardContent>
    </Card>
  );
}

function TaxRow({ label, amount }: { label: string, amount: number }) {
  return (
    <div className="flex justify-between items-center group">
      <span className="text-xs font-mono text-gray-500 uppercase italic group-hover:text-black transition-colors">{label}</span>
      <span className="text-sm font-bold">{amount.toLocaleString('hr-HR', { minimumFractionDigits: 2 })} €</span>
    </div>
  );
}
