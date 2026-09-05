'use client';

import { useState, useEffect, useCallback, useTransition } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  RefreshCw,
  Search,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  ExternalLink,
  Copy,
  Check,
  MessageSquare,
  FileSpreadsheet,
  Activity,
  Layers,
  Phone,
  Home,
  Clock,
} from 'lucide-react';
import { getAppLogsAction, clearAppLogsAction } from '@/actions/log.actions';
import { toast } from 'sonner';
import Link from 'next/link';

interface LogItem {
  _id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  category: 'sms' | 'import' | 'auth' | 'collection' | 'system';
  action: string;
  message: string;
  recipient?: string;
  phone?: string;
  houseNo?: string;
  customerName?: string;
  collectionName?: string;
  collectionId?: string;
  recordId?: string;
  status: 'success' | 'failed' | 'pending';
  gatewayResponse?: string;
  error?: string;
  details?: Record<string, any>;
}

interface LogsStats {
  totalLogs: number;
  totalErrors: number;
  smsTotal: number;
  smsFailed: number;
  smsDelivered: number;
  importTotal: number;
}

interface InitialData {
  logs: LogItem[];
  total: number;
  page: number;
  totalPages: number;
  stats: LogsStats | null;
}

export function LogsViewClient({ initialData }: { initialData: InitialData }) {
  const [logs, setLogs] = useState<LogItem[]>(initialData.logs || []);
  const [stats, setStats] = useState<LogsStats | null>(initialData.stats);
  const [total, setTotal] = useState(initialData.total || 0);
  const [totalPages, setTotalPages] = useState(initialData.totalPages || 1);
  const [page, setPage] = useState(initialData.page || 1);

  // Filters
  const [category, setCategory] = useState<string>('all');
  const [status, setStatus] = useState<string>('all');
  const [level, setLevel] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');

  // Auto-refresh & UI States
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [selectedLog, setSelectedLog] = useState<LogItem | null>(null);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [copiedText, setCopiedText] = useState(false);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Fetch logs with current filters
  const fetchLogs = useCallback(
    async (currentPage = page, silent = false) => {
      if (!silent) {
        startTransition(() => {});
      }
      try {
        const res = await getAppLogsAction({
          category,
          status,
          level,
          search: debouncedSearch,
          page: currentPage,
          limit: 30,
        });

        if ('logs' in res && res.logs) {
          setLogs(res.logs);
          setTotal(res.total);
          if (typeof (res as any).totalPages === 'number') {
            setTotalPages((res as any).totalPages);
          }
          if (res.stats) setStats(res.stats);
        }
      } catch (err: any) {
        if (!silent) {
          toast.error(err?.message || 'Failed to fetch logs');
        }
      }
    },
    [category, status, level, debouncedSearch, page]
  );

  // Refresh when filters change
  useEffect(() => {
    fetchLogs(page);
  }, [fetchLogs, page]);

  // Auto-refresh interval (every 6 seconds when active)
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchLogs(page, true);
    }, 6000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs, page]);

  const handleClearLogs = async () => {
    try {
      const res = await clearAppLogsAction(category === 'all' ? undefined : category);
      if (res.success) {
        toast.success(
          category === 'all'
            ? 'All activity logs cleared'
            : `Cleared ${category.toUpperCase()} logs`
        );
        fetchLogs(1);
      } else {
        toast.error(res.error || 'Failed to clear logs');
      }
    } catch {
      toast.error('An error occurred while clearing logs');
    }
  };

  const handleCopyDetails = (log: LogItem) => {
    const payload = JSON.stringify(
      {
        message: log.message,
        error: log.error,
        details: log.details,
        gatewayResponse: log.gatewayResponse,
        phone: log.phone,
        houseNo: log.houseNo,
        timestamp: log.timestamp,
      },
      null,
      2
    );
    navigator.clipboard.writeText(payload);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 2000);
    toast.success('Log details copied to clipboard');
  };

  const formatRelativeTime = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffSec = Math.floor(diffMs / 1000);
      const diffMin = Math.floor(diffSec / 60);
      const diffHours = Math.floor(diffMin / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffSec < 45) return 'Just now';
      if (diffMin < 60) return `${diffMin}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      return `${diffDays}d ago`;
    } catch {
      return '';
    }
  };

  const formatDateTime = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleString('en-KE', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });
    } catch {
      return timestamp;
    }
  };

  const smsSuccessRate = stats && stats.smsTotal > 0
    ? Math.round((stats.smsDelivered / stats.smsTotal) * 100)
    : 100;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="h-7 w-7 text-primary" />
            System & Activity Logs
          </h1>
          <p className="text-muted-foreground text-sm">
            Live audit trail of SMS deliveries, gateway responses, and spreadsheet operations with actionable diagnostics.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Auto-Refresh Toggle */}
          <Button
            variant={autoRefresh ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              const next = !autoRefresh;
              setAutoRefresh(next);
              toast.info(next ? 'Live auto-refresh enabled' : 'Auto-refresh paused');
            }}
            className="flex items-center gap-2"
          >
            <span
              className={`h-2 w-2 rounded-full ${
                autoRefresh ? 'bg-emerald-400 animate-pulse' : 'bg-muted-foreground'
              }`}
            />
            {autoRefresh ? 'Live Polling (6s)' : 'Auto-refresh'}
          </Button>

          {/* Manual Refresh */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchLogs(page)}
            disabled={isPending}
            className="flex items-center gap-1.5"
          >
            <RefreshCw className={`h-4 w-4 ${isPending ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          {/* Clear Logs */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setClearDialogOpen(true)}
            className="text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Clear
          </Button>
        </div>
      </div>

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Logs */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Activity</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalLogs?.toLocaleString() || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Recorded audit events</p>
          </CardContent>
        </Card>

        {/* SMS Failures */}
        <Card className={stats && stats.smsFailed > 0 ? 'border-destructive/40 bg-destructive/5' : ''}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">SMS Failures</CardTitle>
            <XCircle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${stats && stats.smsFailed > 0 ? 'text-destructive' : ''}`}>
              {stats?.smsFailed?.toLocaleString() || 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {stats && stats.smsFailed > 0
                ? 'Requires attention (invalid phones / credits)'
                : 'Zero SMS delivery errors'}
            </p>
          </CardContent>
        </Card>

        {/* SMS Delivered */}
        <Card className="border-emerald-500/20 bg-emerald-500/5">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">SMS Delivered</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {stats?.smsDelivered?.toLocaleString() || 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Successfully sent to tenants
            </p>
          </CardContent>
        </Card>

        {/* Delivery Success Rate */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">SMS Delivery Rate</CardTitle>
            <MessageSquare className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{smsSuccessRate}%</div>
            <p className="text-xs text-muted-foreground mt-1">
              {stats?.smsTotal || 0} total SMS attempts
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters Bar */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by tenant name, house #, phone, error message..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Category Filter */}
            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
              <Select
                value={category}
                onValueChange={(val) => {
                  if (val) {
                    setCategory(val);
                    setPage(1);
                  }
                }}
              >
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  <SelectItem value="sms">SMS Messages</SelectItem>
                  <SelectItem value="import">Spreadsheet Imports</SelectItem>
                  <SelectItem value="system">System Events</SelectItem>
                </SelectContent>
              </Select>

              {/* Status Filter */}
              <Select
                value={status}
                onValueChange={(val) => {
                  if (val) {
                    setStatus(val);
                    setPage(1);
                  }
                }}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="failed">Failed Only</SelectItem>
                  <SelectItem value="success">Success Only</SelectItem>
                </SelectContent>
              </Select>

              {/* Level Filter */}
              <Select
                value={level}
                onValueChange={(val) => {
                  if (val) {
                    setLevel(val);
                    setPage(1);
                  }
                }}
              >
                <SelectTrigger className="w-[130px]">
                  <SelectValue placeholder="Level" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Levels</SelectItem>
                  <SelectItem value="error">Errors</SelectItem>
                  <SelectItem value="warn">Warnings</SelectItem>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="success">Success</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Logs Table */}
      <Card>
        <CardHeader className="px-6 py-4 border-b flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base font-semibold">Activity Stream</CardTitle>
            <CardDescription className="text-xs">
              Showing {logs.length} of {total} log entries
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {logs.length === 0 ? (
            <div className="py-16 text-center space-y-3">
              <Activity className="h-10 w-10 text-muted-foreground mx-auto opacity-40" />
              <p className="text-base font-medium text-foreground">No logs found</p>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                {searchTerm || category !== 'all' || status !== 'all'
                  ? 'No logs matched the selected filter criteria. Try broadening your search or resetting filters.'
                  : 'Activity logs will automatically populate here whenever SMS messages are sent or spreadsheets are imported.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[140px]">Timestamp</TableHead>
                    <TableHead className="w-[100px]">Status</TableHead>
                    <TableHead className="w-[110px]">Category</TableHead>
                    <TableHead>Event & Diagnostic Message</TableHead>
                    <TableHead className="w-[200px]">Context / Recipient</TableHead>
                    <TableHead className="w-[80px] text-right">Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => {
                    const isError = log.level === 'error' || log.status === 'failed';
                    const isSuccess = log.status === 'success' || log.level === 'success';
                    const isWarn = log.level === 'warn';

                    return (
                      <TableRow
                        key={log._id}
                        className={
                          isError
                            ? 'bg-destructive/5 hover:bg-destructive/10 transition-colors'
                            : 'hover:bg-muted/50 transition-colors'
                        }
                      >
                        {/* Timestamp */}
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          <div className="font-medium text-foreground">
                            {formatRelativeTime(log.timestamp)}
                          </div>
                          <div className="text-[11px] opacity-75">
                            {formatDateTime(log.timestamp)}
                          </div>
                        </TableCell>

                        {/* Status Badge */}
                        <TableCell>
                          {isError && (
                            <Badge variant="destructive" className="flex items-center gap-1 w-fit">
                              <XCircle className="h-3 w-3" />
                              Failed
                            </Badge>
                          )}
                          {isSuccess && (
                            <Badge
                              variant="outline"
                              className="bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800 flex items-center gap-1 w-fit"
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              Delivered
                            </Badge>
                          )}
                          {isWarn && (
                            <Badge
                              variant="outline"
                              className="bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800 flex items-center gap-1 w-fit"
                            >
                              <AlertTriangle className="h-3 w-3" />
                              Warning
                            </Badge>
                          )}
                          {!isError && !isSuccess && !isWarn && (
                            <Badge variant="secondary" className="flex items-center gap-1 w-fit">
                              <Info className="h-3 w-3" />
                              Info
                            </Badge>
                          )}
                        </TableCell>

                        {/* Category */}
                        <TableCell>
                          <div className="flex items-center gap-1.5 text-xs font-medium">
                            {log.category === 'sms' && (
                              <MessageSquare className="h-3.5 w-3.5 text-blue-500" />
                            )}
                            {log.category === 'import' && (
                              <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-500" />
                            )}
                            {log.category === 'collection' && (
                              <Layers className="h-3.5 w-3.5 text-indigo-500" />
                            )}
                            {log.category === 'system' && (
                              <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                            <span className="uppercase tracking-wider text-[10px]">
                              {log.category}
                            </span>
                          </div>
                        </TableCell>

                        {/* Event & Diagnostic Message */}
                        <TableCell>
                          <div className="space-y-0.5">
                            <p
                              className={`text-sm font-medium leading-snug ${
                                isError ? 'text-destructive font-semibold' : 'text-foreground'
                              }`}
                            >
                              {log.message}
                            </p>
                            {log.error && log.error !== log.message && (
                              <p className="text-xs text-muted-foreground font-mono bg-muted/60 p-1 rounded inline-block max-w-xl truncate">
                                Raw Error: {log.error}
                              </p>
                            )}
                          </div>
                        </TableCell>

                        {/* Context / Recipient */}
                        <TableCell className="text-xs">
                          <div className="space-y-1">
                            {log.customerName && (
                              <div className="font-semibold text-foreground">
                                {log.customerName}
                              </div>
                            )}
                            <div className="flex items-center gap-2 flex-wrap text-muted-foreground">
                              {log.houseNo && (
                                <span className="inline-flex items-center gap-1 bg-muted px-1.5 py-0.5 rounded text-[11px] font-mono">
                                  <Home className="h-2.5 w-2.5" />
                                  Hse #{log.houseNo}
                                </span>
                              )}
                              {log.phone && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-mono">
                                  <Phone className="h-2.5 w-2.5" />
                                  {log.phone}
                                </span>
                              )}
                            </div>
                            {log.collectionName && (
                              <div className="text-[11px] text-muted-foreground truncate max-w-[180px]">
                                {log.collectionId ? (
                                  <Link
                                    href={`/collections/${log.collectionId}`}
                                    className="hover:underline text-primary flex items-center gap-1"
                                  >
                                    <Layers className="h-2.5 w-2.5" />
                                    {log.collectionName}
                                  </Link>
                                ) : (
                                  <span>{log.collectionName}</span>
                                )}
                              </div>
                            )}
                          </div>
                        </TableCell>

                        {/* Actions */}
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedLog(log)}
                            className="h-8 px-2 text-xs"
                          >
                            Details
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-4 border-t">
              <p className="text-xs text-muted-foreground">
                Page {page} of {totalPages} ({total} total logs)
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || isPending}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages || isPending}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Log Details Modal */}
      <Dialog open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          {selectedLog && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2 mb-1">
                  <Badge
                    variant={selectedLog.status === 'failed' ? 'destructive' : 'default'}
                    className="capitalize"
                  >
                    {selectedLog.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground uppercase font-semibold">
                    {selectedLog.category} • {selectedLog.action}
                  </span>
                </div>
                <DialogTitle className="text-lg leading-snug">
                  {selectedLog.message}
                </DialogTitle>
                <DialogDescription className="text-xs">
                  Logged on {formatDateTime(selectedLog.timestamp)}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 pt-2">
                {/* Meta info grid */}
                <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-muted/50 text-xs">
                  <div>
                    <span className="text-muted-foreground font-medium">Recipient / Name:</span>
                    <p className="font-semibold text-foreground mt-0.5">
                      {selectedLog.customerName || selectedLog.recipient || 'N/A'}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground font-medium">House Number:</span>
                    <p className="font-semibold text-foreground mt-0.5">
                      {selectedLog.houseNo ? `#${selectedLog.houseNo}` : 'N/A'}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground font-medium">Phone Number:</span>
                    <p className="font-mono font-semibold text-foreground mt-0.5">
                      {selectedLog.phone || 'N/A'}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground font-medium">Collection:</span>
                    <p className="font-semibold text-foreground mt-0.5 truncate">
                      {selectedLog.collectionName || 'N/A'}
                    </p>
                  </div>
                </div>

                {/* SMS Message content if available */}
                {selectedLog.details?.message && (
                  <div className="space-y-1.5">
                    <span className="text-xs font-semibold text-muted-foreground">
                      SMS Message Content:
                    </span>
                    <div className="p-3 bg-muted rounded-md text-xs font-mono whitespace-pre-wrap leading-relaxed">
                      {selectedLog.details.message}
                    </div>
                  </div>
                )}

                {/* Raw Error Details */}
                {selectedLog.error && (
                  <div className="space-y-1.5">
                    <span className="text-xs font-semibold text-destructive">
                      Error Diagnostics:
                    </span>
                    <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive rounded-md text-xs font-mono whitespace-pre-wrap">
                      {selectedLog.error}
                    </div>
                  </div>
                )}

                {/* Gateway response / technical payload */}
                {(selectedLog.gatewayResponse || selectedLog.details) && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-muted-foreground">
                        Technical Payload & Gateway Response:
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCopyDetails(selectedLog)}
                        className="h-6 px-2 text-xs"
                      >
                        {copiedText ? (
                          <>
                            <Check className="h-3 w-3 mr-1 text-emerald-500" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3 mr-1" />
                            Copy JSON
                          </>
                        )}
                      </Button>
                    </div>
                    <pre className="p-3 bg-muted rounded-md text-[11px] font-mono overflow-x-auto max-h-48 whitespace-pre">
                      {JSON.stringify(
                        selectedLog.gatewayResponse || selectedLog.details,
                        null,
                        2
                      )}
                    </pre>
                  </div>
                )}

                {/* Footer Buttons */}
                <div className="flex items-center justify-between pt-2 border-t">
                  {selectedLog.collectionId ? (
                    <Link href={`/collections/${selectedLog.collectionId}`}>
                      <Button variant="outline" size="sm" className="text-xs flex items-center gap-1">
                        <ExternalLink className="h-3 w-3" />
                        Go to Collection
                      </Button>
                    </Link>
                  ) : (
                    <div />
                  )}
                  <Button size="sm" onClick={() => setSelectedLog(null)}>
                    Close
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirm Clear Logs Dialog */}
      <ConfirmDialog
        open={clearDialogOpen}
        onOpenChange={setClearDialogOpen}
        onConfirm={handleClearLogs}
        title="Clear Activity Logs"
        message={
          category === 'all'
            ? 'Are you sure you want to delete all activity logs? This action cannot be undone.'
            : `Are you sure you want to delete all ${category.toUpperCase()} logs? This action cannot be undone.`
        }
        confirmLabel="Clear Logs"
      />
    </div>
  );
}
