module SpecView
  module Util
    class << self
      def chrome_extension_path
        File.join(__dir__, "chrome_extension")
      end
    end
  end
end