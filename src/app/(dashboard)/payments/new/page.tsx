import { PaymentForm } from '@/components/PaymentForm';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function NewPaymentPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Record New Payment</CardTitle>
        </CardHeader>
        <CardContent>
          <PaymentForm />
        </CardContent>
      </Card>
    </div>
  );
}
