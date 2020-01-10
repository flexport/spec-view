
$LOAD_PATH.push(File.expand_path("lib", __dir__))
require "spec-view/version"

Gem::Specification.new do |spec|
  spec.name          = "spec-view"
  spec.version       = Spec::View::VERSION
  spec.authors = ['Flexport Engineering']
  spec.email = ['dev@flexport.com']

  spec.summary       = %q{Page Object architecture for integration testing React apps with RSpec and ChromeDriver.}
  spec.homepage      = "https://github.com/flexport/spec-view"
  spec.license       = "MIT"

  # Prevent pushing this gem to RubyGems.org. To allow pushes either set the 'allowed_push_host'
  # to allow pushing to a single host or delete this section to allow pushing to any host.
  if spec.respond_to?(:metadata)
    spec.metadata["allowed_push_host"] = "TODO: Set to 'http://mygemserver.com'"
  else
    raise "RubyGems 2.0 or newer is required to protect against " \
      "public gem pushes."
  end

  # Specify which files should be added to the gem when it is released.
  # The `git ls-files -z` loads the files in the RubyGem that have been added into git.
  spec.files = Dir["{lib}/**/*"]
  spec.bindir        = "exe"
  spec.executables   = spec.files.grep(%r{^exe/}) { |f| File.basename(f) }
  spec.require_paths = ["lib"]

  spec.add_development_dependency "bundler", "~> 1.16"
  spec.add_development_dependency "rake", "~> 10.0"
end
