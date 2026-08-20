import { Routes, Route } from "react-router";
import { Toaster } from "@/components/ui/sonner";
import BoardPage from "./pages/BoardPage";

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<BoardPage />} />
        {/* 通配路由是有意的 SPA 回退：任意路径都回落到看板页 */}
        <Route path="*" element={<BoardPage />} />
      </Routes>
      <Toaster position="top-center" />
    </>
  );
}
