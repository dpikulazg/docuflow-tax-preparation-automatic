import React, { useState, useEffect, useRef } from 'react';
import { UserProfile, Tenant, Document } from './types';
import { api, AppUser, AuthenticationError } from './lib/api';
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
  const [user, setUser] = useState<AppUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [clients, setClients] = useState<Tenant[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isUploading, setIsUploading] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [authAction, setAuthAction] = useState<'login' | 'logout' | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const authTransition = useRef(false);

  useEffect(() => {
    // Recheck the server session when Back restores a page after an Access redirect.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  const clearSession = () => {
    setUser(null);
    setProfile(null);
    setTenant(null);
    setClients([]);
    setDocuments([]);
    setSelectedDoc(null);
    setActiveTab('dashboard');
  };

  useEffect(() => {
    let active = true;
    const url = new URL(window.location.href);
    if (url.searchParams.has('authError')) {
      setAuthError('Prijava nije dostupna. Obratite se administratoru i pokušajte ponovno.');
      url.searchParams.delete('authError');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
    api.getSession().then((session) => {
      if (!active || authTransition.current) return;
      setUser(session.user);
      setProfile(session.profile);
      setTenant(session.tenant);
      setLoading(false);
    }).catch((error) => {
      if (!active || authTransition.current) return;
      if (!(error instanceof AuthenticationError)) {
        console.error('Cloudflare Access session failed', error);
        setAuthError('Sesija se nije mogla učitati. Pokušajte se ponovno prijaviti.');
      }
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const load = async () => {
      try {
        const [nextDocuments, nextClients] = await Promise.all([
          api.getDocuments(),
          profile?.role === 'accountant' || profile?.role === 'admin' ? api.getClients() : Promise.resolve([] as Tenant[]),
        ]);
        if (active && !authTransition.current) {
          setDocuments(nextDocuments);
          setClients(nextClients);
        }
      } catch (error) {
        if (!active || authTransition.current) return;
        if (error instanceof AuthenticationError) {
          active = false;
          clearSession();
          setAuthError('Sesija je istekla ili pristup nije dopušten. Prijavite se ponovno.');
          return;
        }
        console.error('Cloudflare data loading failed', error);
        toast.error('Podaci se nisu mogli učitati');
      }
    };
    load();
    const interval = window.setInterval(load, 10000);
    return () => { active = false; window.clearInterval(interval); };
  }, [user, profile]);

  const handleLogin = () => {
    if (authTransition.current) return;
    authTransition.current = true;
    setAuthAction('login');
    setAuthError(null);
    try {
      api.login();
    } catch (error) {
      authTransition.current = false;
      setAuthAction(null);
      setAuthError('Prijava nije uspjela. Pokušajte ponovno.');
    }
  };

  const handleLogout = () => {
    if (authTransition.current) return;
    authTransition.current = true;
    setAuthAction('logout');
    clearSession();
    setAuthError(null);
    try {
      api.logout();
    } catch (error) {
      authTransition.current = false;
      setAuthAction(null);
      setAuthError('Odjava nije dovršena. Pokušajte ponovno.');
    }
  };

  const onDrop = async (acceptedFiles: File[]) => {
    if (!profile || !tenant) return;
    setIsUploading(true);
    toast.info('Processing document with AI...');

    for (const file of acceptedFiles) {
      try {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(',')[1]);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        const recognized = await recognizeInvoice(base64, file.type);
        if (recognized.items) {
          recognized.items = recognized.items.map((item: any) => ({ ...item, id: item.id || crypto.randomUUID() }));
        }
        await api.createDocument(file, recognized, profile.tenantId);
        toast.success(`Processed ${file.name}`);
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
      <div className="h-screen w-full flex flex-col items-center justify-center bg-[#fdfbf7] p-6 relative overflow-hidden">
        {/* Subtle grid background */}
        <div className="absolute inset-0 opacity-[0.05]" style={{ backgroundImage: 'radial-gradient(circle, #000 1px, transparent 1px)', backgroundSize: '24px 24px' }}></div>
        
        {/* Decorative elements */}
        <div className="absolute top-10 left-10 w-24 h-24 bg-[#EBE7DF] border-2 border-black rounded-full mix-blend-multiply blur-sm opacity-50 hidden md:block animate-pulse"></div>
        <div 
          className="absolute bottom-20 right-10 bg-gray-200 border-2 rounded-none mix-blend-multiply opacity-30 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] hidden md:block"
          style={{ paddingLeft: '4px', marginLeft: '6px', fontWeight: 'bold', borderColor: '#735f5f', borderStyle: 'ridge', width: '-1px', height: '-1px' }}
        ></div>

        <motion.div 
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="max-w-xl w-full z-10"
        >
          <div className="text-center space-y-4 mb-10">
            <h1 className="text-7xl font-bold tracking-tighter uppercase italic font-serif text-black drop-shadow-sm">Docu<span className="text-stone-500">Flow</span></h1>
            <p className="text-xs font-mono text-stone-600 uppercase tracking-widest bg-stone-200 inline-block px-3 py-1 border border-black/20">
              Hrvatska platforma za upravljanje dokumentima
            </p>
          </div>
          
          <Card className="border-4 border-black shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] rounded-none bg-white relative overflow-hidden group">
            {/* Accent top bar */}
            <div className="absolute top-0 left-0 w-full h-2 bg-black"></div>
            <CardHeader className="pt-8 pb-6 text-center">
              <CardTitle className="text-3xl font-bold uppercase tracking-tight text-black">Dobrodošli natrag</CardTitle>
              <CardDescription className="text-stone-500 text-sm mt-2 font-medium">Prijavite se za upravljanje dokumentima i računovodstvenim workflow-om u oblaku.</CardDescription>
            </CardHeader>
            <CardContent className="px-8 pb-8">
              {authError && <p role="alert" className="mb-4 text-sm text-red-700">{authError}</p>}
              <Button 
                onClick={handleLogin}
                disabled={authAction !== null}
                aria-busy={authAction !== null}
                className="w-full h-14 bg-black text-white hover:bg-stone-900 hover:text-white rounded-none font-bold text-sm uppercase tracking-widest transition-all hover:-translate-y-1 hover:shadow-[6px_6px_0px_0px_rgba(200,200,200,1)] active:translate-x-1 active:translate-y-1 active:shadow-none flex items-center justify-center gap-3"
              >
                <svg className="w-5 h-5 bg-white rounded-full p-1 text-black" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                {authAction === 'login' ? 'Prijava u tijeku...' : authAction === 'logout' ? 'Odjava u tijeku...' : 'Prijava putem Google-a'}
              </Button>
            </CardContent>
          </Card>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left mt-8">
            <div className="p-5 border-2 border-black bg-[#F4F1E9] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] transition-all hover:-translate-y-1">
              <h3 className="font-bold text-sm uppercase mb-2 text-black flex items-center gap-2">
                <span className="w-2 h-2 bg-blue-500 block"></span>
                Za Tvrtke
              </h3>
              <p className="text-xs text-stone-600 font-medium leading-relaxed">Automatsko slanje računa, real-time podaci o ulazu robe i pametna provjera statusa plaćanja.</p>
            </div>
            <div className="p-5 border-2 border-black bg-[#F4F1E9] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] transition-all hover:-translate-y-1">
              <h3 className="font-bold text-sm uppercase mb-2 text-black flex items-center gap-2">
                <span className="w-2 h-2 bg-amber-500 block"></span>
                Za Računovodstva
              </h3>
              <p className="text-xs text-stone-600 font-medium leading-relaxed">Standardizirani export podataka kroz API, 1-click prepoznavanje dokumenata i ERP sinkronizacija.</p>
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
            disabled={authAction !== null}
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
