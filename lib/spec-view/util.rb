module SpecView
  module Util
    class << self
      def chrome_extension_path
        File.join(__dir__, "chrome_extension")
      end

      def chrome_arguments
        ["--load-extension=#{chrome_extension_path}"]
      end
    end
  end
end