import { ContactsApp } from "@/components/contacts/contacts-app";

export default async function KontaktePage({
  searchParams,
}: {
  searchParams: Promise<{ neu?: string; email?: string; name?: string }>;
}) {
  const params = await searchParams;
  return (
    <ContactsApp
      initialCreate={params.neu === "1"}
      initialEmail={params.email}
      initialName={params.name}
    />
  );
}
