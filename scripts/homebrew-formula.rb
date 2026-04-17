class Kimbo < Formula
  desc "GPU-accelerated terminal emulator optimized for multi-pane workflows"
  homepage "https://github.com/kimbo/kimbo"
  url "https://github.com/kimbo/kimbo/archive/refs/tags/v0.1.0.tar.gz"
  sha256 "PLACEHOLDER_SHA256"
  license "MIT"

  depends_on "rust" => :build
  depends_on :macos

  def install
    system "cargo", "build", "--release", "--locked"
    bin.install "target/release/kimbo"
  end

  test do
    assert_match "kimbo", shell_output("#{bin}/kimbo --version 2>&1", 1)
  end
end
