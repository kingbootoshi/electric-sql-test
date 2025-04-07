-- Create todos table in Supabase that matches our local schema
CREATE TABLE IF NOT EXISTS public.todos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Enable row level security
ALTER TABLE public.todos ENABLE ROW LEVEL SECURITY;

-- Create a policy that allows all operations for now
-- In a production app, you would want to restrict this based on user authentication
CREATE POLICY "Allow all operations for now" ON public.todos
  USING (true)
  WITH CHECK (true);

-- Enable logical replication for ElectricSQL
ALTER TABLE public.todos REPLICA IDENTITY FULL;
