import { useEffect, useState } from 'react';
import { RefreshCw, type LucideProps } from 'lucide-react';

/** One turn of Tailwind's animate-spin. */
const TURN = 1000;

// A refresh that ends mid-turn would snap the arrow back and a quick one would
// only flicker, so the icon keeps turning until it completes its rotation.
export function RefreshIcon({ spinning, className = '', ...props }: LucideProps & { spinning: boolean }) {
  const [turning, setTurning] = useState(spinning);
  useEffect(() => {
    if (spinning) { setTurning(true); return; }
    // A paused animation, as in a hidden page, never reaches the end of its turn.
    const timer = setTimeout(() => setTurning(false), TURN + 100);
    return () => clearTimeout(timer);
  }, [spinning]);
  return <RefreshCw {...props} data-spinning={turning || undefined} className={`${className} ${turning ? 'animate-spin' : ''}`.trim() || undefined} onAnimationIteration={() => { if (!spinning) setTurning(false); }} />;
}
