import { ManagementView } from "@/components/ManagementView";

export default function ManagementPage() {
  return (
    <main className="shell shell-wide">
      <div className="atmosphere" aria-hidden />
      <ManagementView />
    </main>
  );
}
