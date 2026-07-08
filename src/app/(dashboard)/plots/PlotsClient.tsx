'use client';

import { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { createPlot, updatePlot, deletePlot } from '@/actions/plot.actions';
import { Plus, Pencil, Trash2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';

interface CustomerRef {
  _id: string;
  name: string;
  phone: string;
}

interface Plot {
  _id: string;
  plotNumber: string;
  project: string;
  location: string;
  size: number;
  price: number;
  status: 'available' | 'reserved' | 'sold';
  customer?: CustomerRef | null;
}

export function PlotsClient({
  plots: initial,
  isAdmin,
}: {
  plots: Plot[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [plots, setPlots] = useState(initial);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Plot | null>(null);
  const [form, setForm] = useState({
    plotNumber: '',
    project: '',
    location: '',
    size: '',
    price: '',
    status: 'available' as 'available' | 'reserved' | 'sold',
  });

  const statusLabels: Record<string, string> = {
    available: 'Available',
    reserved: 'Reserved',
    sold: 'Sold',
  };

  const filtered = plots.filter(
    (p) =>
      p.plotNumber.toLowerCase().includes(search.toLowerCase()) ||
      p.project.toLowerCase().includes(search.toLowerCase()) ||
      p.location.toLowerCase().includes(search.toLowerCase())
  );

  const resetForm = () => {
    setForm({ plotNumber: '', project: '', location: '', size: '', price: '', status: 'available' });
    setEditing(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const data = {
      plotNumber: form.plotNumber,
      project: form.project,
      location: form.location,
      size: Number(form.size),
      price: Number(form.price),
      status: form.status,
    };

    if (editing) {
      const res = await updatePlot(editing._id, data);
      if (res.success) {
        toast.success('Plot updated');
        setOpen(false);
        resetForm();
        router.refresh();
      }
    } else {
      const res = await createPlot(data);
      if (res.success) {
        toast.success('Plot created');
        setOpen(false);
        resetForm();
        router.refresh();
      }
    }
  };

  const handleEdit = (plot: Plot) => {
    setEditing(plot);
    setForm({
      plotNumber: plot.plotNumber,
      project: plot.project,
      location: plot.location,
      size: String(plot.size),
      price: String(plot.price),
      status: plot.status,
    });
    setOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Delete this plot?')) {
      const res = await deletePlot(id);
      if (res.success) {
        toast.success('Plot deleted');
        setPlots((prev) => prev.filter((p) => p._id !== id));
      }
    }
  };

  const statusBadgeVariant = (status: string) => {
    switch (status) {
      case 'available':
        return 'default' as const;
      case 'reserved':
        return 'secondary' as const;
      case 'sold':
        return 'destructive' as const;
      default:
        return 'outline' as const;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search plots..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button><Plus className="h-4 w-4 mr-2" />Add Plot</Button>} />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? 'Edit Plot' : 'Add Plot'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="plotNumber">Plot Number</Label>
                  <Input
                    id="plotNumber"
                    value={form.plotNumber}
                    onChange={(e) => setForm({ ...form, plotNumber: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="project">Project</Label>
                  <Input
                    id="project"
                    value={form.project}
                    onChange={(e) => setForm({ ...form, project: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="location">Location</Label>
                  <Input
                    id="location"
                    value={form.location}
                    onChange={(e) => setForm({ ...form, location: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="size">Size (acres)</Label>
                  <Input
                    id="size"
                    type="number"
                    step="0.01"
                    value={form.size}
                    onChange={(e) => setForm({ ...form, size: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="price">Price (KES)</Label>
                  <Input
                    id="price"
                    type="number"
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="status">Status</Label>
                  <Select
                    value={form.status}
                    onValueChange={(v) =>
                      v && setForm({ ...form, status: v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue>{statusLabels[form.status]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="available">Available</SelectItem>
                      <SelectItem value="reserved">Reserved</SelectItem>
                      <SelectItem value="sold">Sold</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button type="submit" className="w-full">
                {editing ? 'Update' : 'Create'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Plot #</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((plot) => (
              <TableRow key={plot._id}>
                <TableCell className="font-medium">{plot.plotNumber}</TableCell>
                <TableCell>{plot.project}</TableCell>
                <TableCell>{plot.location}</TableCell>
                <TableCell>{plot.size} acres</TableCell>
                <TableCell>KES {plot.price.toLocaleString()}</TableCell>
                <TableCell>
                  <Badge variant={statusBadgeVariant(plot.status)}>{plot.status}</Badge>
                </TableCell>
                <TableCell>{plot.customer?.name || '-'}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => handleEdit(plot)}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                    {isAdmin && (
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(plot._id)}>
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
